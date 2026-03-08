/**
 * GeminiAdapter
 *
 * Wraps @google/genai's GoogleGenAI.models.generateContentStream() to produce
 * NormalizedChunk objects for the universal-agent-acp pipeline.
 *
 * Auth priority:
 *   1. GOOGLE_API_KEY env var (AI Studio key) — simplest for personal use.
 *   2. GEMINI_API_KEY env var (alias for AI Studio key).
 *   3. Vertex AI via Application Default Credentials:
 *      GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION env vars (or defaults).
 *
 * The Gemini SDK's generateContentStream() accepts the full message history
 * via the `contents` parameter, so no context-stuffing limitation applies here.
 */

import { GoogleGenAI, type Content } from "@google/genai";
import type { CanonicalMessage } from "../context/types.js";
import type { NormalizedChunk, ProviderAdapter } from "./types.js";
import { toGeminiContents, extractSystemPrompt } from "./types.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
import { toGeminiTools } from "../tools/converters.js";

function createClient(overrideApiKey?: string): GoogleGenAI {
  const envKey = process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  const apiKey = overrideApiKey ?? envKey;

  if (apiKey) {
    process.stderr.write(`[GEON] Initializing Gemini with API Key (Mode: AI Studio)\n`);
    return new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "antigravity" } },
    });
  }

  // Fall back to Vertex AI via ADC.
  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  const location = process.env["GOOGLE_CLOUD_LOCATION"];

  if (project && location) {
    process.stderr.write(`[GEON] Initializing Gemini with Project ${project} (Mode: Vertex AI)\n`);
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  process.stderr.write(`[GEON] WARNING: No Gemini API Key or Vertex AI config found!\n`);
  throw new Error(
    "Gemini requires either an API Key (GOOGLE_API_KEY) or Vertex AI config (GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION)",
  );
}

/**
 * Perform a one-off "Grounded Search" using Gemini's native Google Search tool.
 * This is a clean request with NO function declarations to avoid API conflicts.
 */
export async function groundedSearch(prompt: string): Promise<string> {
  const client = createClient();
  const modelId = process.env["GEMINI_SEARCH_MODEL"] || "gemini-2.0-flash";

  const MAX_RETRIES = 12;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const response = await client.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = (response as any).text;
      return text || "No results found from Google Search grounding.";
    } catch (err: unknown) {
      const errorStr = String(err);
      const isRetryable = errorStr.includes("503") ||
        errorStr.includes("Service Unavailable") ||
        errorStr.includes("high demand") ||
        errorStr.includes("429") ||
        errorStr.includes("RESOURCE_EXHAUSTED") ||
        (err as any)?.status === "RESOURCE_EXHAUSTED" ||
        (err as any)?.code === 429;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = (Math.pow(2, attempt) * 1000) + Math.floor(Math.random() * 1000);
        process.stderr.write(`[GEON] groundedSearch transient error. Retrying attempt ${attempt}/${MAX_RETRIES} in ${delay}ms...\n`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  return "Failed to complete search after maximum retries.";
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "google" as const;
  readonly modelId: string;
  private apiKey?: string;

  constructor(modelId: string, options?: { apiKey?: string }) {
    this.modelId = modelId;
    this.apiKey = options?.apiKey;
  }

  async *stream(
    _sessionId: string,
    messages: CanonicalMessage[],
    systemPrompt: string,
    _tools: readonly unknown[],  // reserved; GeminiAdapter always uses BUILT_IN_TOOLS
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    const client = createClient(this.apiKey);

    // Derive systemInstruction: prefer explicit systemPrompt param; fall back
    // to extracting system-role messages from the history.
    const sysInstruction =
      systemPrompt || extractSystemPrompt(messages) || undefined;

    const contents = toGeminiContents(messages) as Content[];

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;

    const MAX_RETRIES = 12; // Increased for Gemini free-tier stability
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      if (signal.aborted) break;
      attempt++;

      try {
        const geminiTools = toGeminiTools(_tools as any);

        const stream = await client.models.generateContentStream({
          model: this.modelId,
          contents,
          config: {
            ...(sysInstruction ? { systemInstruction: sysInstruction } : {}),
            tools: [{ functionDeclarations: geminiTools }],
            abortSignal: signal,
          },
        });

        for await (const chunk of stream) {
          if (signal.aborted) break;

          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if ("text" in p && p.text) {
              yield { type: "text", text: p.text };
            } else if ("functionCall" in p && p.functionCall) {
              const fc = p.functionCall as { name?: string; args?: unknown; thought_signature?: string };
              yield {
                type: "tool_call",
                toolName: fc.name ?? "",
                toolInput: fc.args ?? {},
                thoughtSignature: fc.thought_signature || (p as any).thoughtSignature,
              };
            }
          }

          const u = chunk.usageMetadata;
          if (u) {
            inputTokens = u.promptTokenCount ?? inputTokens;
            outputTokens = u.candidatesTokenCount ?? outputTokens;
            cacheHitTokens = u.cachedContentTokenCount ?? cacheHitTokens;
          }
        }

        // Success, exit the retry loop
        break;

      } catch (err: unknown) {
        if (signal.aborted) return;

        const errorStr = String(err);
        const isRetryable = errorStr.includes("503") ||
          errorStr.includes("Service Unavailable") ||
          errorStr.includes("high demand") ||
          errorStr.includes("429") ||
          errorStr.includes("RESOURCE_EXHAUSTED") ||
          (err as any)?.status === "RESOURCE_EXHAUSTED" ||
          (err as any)?.code === 429;

        if (isRetryable && attempt < MAX_RETRIES) {
          // Jittered exponential backoff
          const delay = (Math.pow(2, attempt) * 1000) + Math.floor(Math.random() * 1000);
          process.stderr.write(`[GEON] Gemini transient error detected (503/429). Retrying attempt ${attempt}/${MAX_RETRIES} in ${delay}ms... (Error: ${errorStr.slice(0, 100)})\n`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    yield {
      type: "done",
      inputTokens,
      outputTokens,
      cacheHitTokens,
    };
  }
}

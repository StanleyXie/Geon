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

function createClient(): GoogleGenAI {
  const apiKey =
    process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }

  // Fall back to Vertex AI via ADC. Both env vars are required.
  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  const location = process.env["GOOGLE_CLOUD_LOCATION"];
  if (!project || !location) {
    throw new Error(
      "Gemini Vertex AI requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION env vars",
    );
  }
  return new GoogleGenAI({ vertexai: true, project, location });
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "google" as const;
  readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async *stream(
    messages: CanonicalMessage[],
    systemPrompt: string,
    _tools: unknown[],  // reserved; GeminiAdapter always uses BUILT_IN_TOOLS
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    const client = createClient();

    // Derive systemInstruction: prefer explicit systemPrompt param; fall back
    // to extracting system-role messages from the history.
    const sysInstruction =
      systemPrompt || extractSystemPrompt(messages) || undefined;

    // Convert the canonical message history (user + assistant turns) to Gemini
    // Content[] format. System messages are filtered out by toGeminiContents().
    // Cast to the SDK's Content[] type — GeminiContent is structurally
    // compatible for text, functionCall, and functionResponse parts.
    const contents = toGeminiContents(messages) as Content[];

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;

    try {
      const geminiTools = toGeminiTools(BUILT_IN_TOOLS);

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
            const fc = p.functionCall as { name?: string; args?: unknown };
            // toolUseId intentionally absent — server assigns a UUID in the agentic loop
            yield {
              type: "tool_call",
              toolName: fc.name ?? "",
              toolInput: fc.args ?? {},
            };
          }
        }

        // Accumulate usage from each chunk (Gemini reports running totals per chunk).
        const u = chunk.usageMetadata;
        if (u) {
          inputTokens = u.promptTokenCount ?? inputTokens;
          outputTokens = u.candidatesTokenCount ?? outputTokens;
          cacheHitTokens = u.cachedContentTokenCount ?? cacheHitTokens;
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      throw err;
    }

    yield {
      type: "done",
      inputTokens,
      outputTokens,
      cacheHitTokens,
    };
  }
}

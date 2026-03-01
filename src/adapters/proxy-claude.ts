/**
 * ProxyClaudeAdapter
 *
 * Routes Claude model requests through the Antigravity proxy
 * (http://127.0.0.1:8045 by default), which exposes a standard
 * Anthropic-compatible /v1/messages API backed by Google AI Pro
 * accounts via Vertex AI v1internal.
 *
 * Unlike ClaudeAdapter (claude-agent-sdk), this adapter:
 *   - Passes the FULL message history (not just the latest user message)
 *   - Uses @anthropic-ai/sdk with a custom baseURL pointing to the proxy
 *   - Does NOT require a local claude CLI installation
 *
 * Config (env vars):
 *   ANTIGRAVITY_BASE_URL — proxy base URL (default: http://127.0.0.1:8045)
 *   ANTIGRAVITY_API_KEY  — proxy API key (required; proxy enforces auth)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CanonicalMessage } from "../context/types.js";
import type { NormalizedChunk, ProviderAdapter } from "./types.js";
import { extractSystemPrompt, toAnthropicMessages } from "./types.js";

function createClient(): Anthropic {
  const apiKey = process.env["ANTIGRAVITY_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ProxyClaudeAdapter requires ANTIGRAVITY_API_KEY env var",
    );
  }
  return new Anthropic({
    apiKey,
    baseURL: process.env["ANTIGRAVITY_BASE_URL"] ?? "http://127.0.0.1:8045",
  });
}

export class ProxyClaudeAdapter implements ProviderAdapter {
  readonly provider = "google-claude" as const;
  readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async *stream(
    messages: CanonicalMessage[],
    systemPrompt: string,
    _tools: unknown[],   // tool definitions forwarded via BUILT_IN_TOOLS in Task 8
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    const client = createClient();

    const sysPrompt = systemPrompt || extractSystemPrompt(messages) || undefined;
    const anthropicMessages = toAnthropicMessages(messages);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;

    try {
      const stream = await client.messages.create({
        model: this.modelId,
        max_tokens: 32768,
        ...(sysPrompt ? { system: sysPrompt } : {}),
        messages: anthropicMessages,
        stream: true,
      });

      // @anthropic-ai/sdk returns an async iterable of raw SSE events when stream: true
      for await (const event of stream) {
        if (signal.aborted) break;

        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text", text: event.delta.text };
        } else if (event.type === "message_delta" && event.usage) {
          outputTokens = event.usage.output_tokens;
        } else if (event.type === "message_start" && event.message.usage) {
          const u = event.message.usage as unknown as Record<string, unknown>;
          inputTokens = u["input_tokens"] as number ?? 0;
          cacheHitTokens = u["cache_read_input_tokens"] as number ?? 0;
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

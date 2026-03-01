import type Anthropic from "@anthropic-ai/sdk";
import type { CanonicalMessage } from "../context/types.js";

export interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }>;
}

export interface NormalizedChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  toolResult?: unknown;
  isError?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheHitTokens?: number;
}

export interface ProviderAdapter {
  readonly provider: "anthropic" | "google" | "google-claude";
  readonly modelId: string;
  stream(
    messages: CanonicalMessage[],
    systemPrompt: string,
    tools: unknown[],
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk>;
}

// ─── Format converters ──────────────────────────────────────────────────────

export function toAnthropicMessages(messages: CanonicalMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      result.push({ role: "assistant", content: m.content });
    } else if (m.role === "tool_call") {
      const meta = m.metadata as { toolUseId: string; toolName: string; toolInput: unknown };
      result.push({
        role: "assistant",
        content: [{ type: "tool_use", id: meta.toolUseId, name: meta.toolName, input: meta.toolInput as Record<string, unknown> }],
      });
    } else if (m.role === "tool_result") {
      const meta = m.metadata as { toolUseId: string; isError?: boolean };
      result.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: meta.toolUseId,
          content: m.content,
          ...(meta.isError ? { is_error: true } : {}),
        }],
      });
    }
    // system messages handled separately via extractSystemPrompt
  }
  return result;
}

export function toGeminiContents(messages: CanonicalMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      result.push({ role: "model", parts: [{ text: m.content }] });
    } else if (m.role === "tool_call") {
      const meta = m.metadata as { toolName: string; toolInput: unknown };
      result.push({ role: "model", parts: [{ functionCall: { name: meta.toolName, args: meta.toolInput } }] });
    } else if (m.role === "tool_result") {
      const meta = m.metadata as { toolName: string };
      result.push({ role: "user", parts: [{ functionResponse: { name: meta.toolName, response: { output: m.content } } }] });
    }
    // system messages handled separately via extractSystemPrompt
  }
  return result;
}

export function extractSystemPrompt(messages: CanonicalMessage[]): string {
  return messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n");
}

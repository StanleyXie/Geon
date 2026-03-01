import type { CanonicalMessage } from "../context/types.js";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }>;
}

export interface NormalizedChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
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

export function toAnthropicMessages(messages: CanonicalMessage[]): AnthropicMessage[] {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export function toGeminiContents(messages: CanonicalMessage[]): GeminiContent[] {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user" as const,
      parts: [{ text: m.content }],
    }));
}

export function extractSystemPrompt(messages: CanonicalMessage[]): string {
  return messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n");
}

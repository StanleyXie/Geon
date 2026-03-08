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
  /**
   * When true the tool was already executed by the provider's own agentic
   * loop (e.g. Claude Agent SDK). The ACP server must NOT run executeToolCall
   * locally — it should only emit ACP tool_call / tool_call_update
   * notifications for UI observability.
   */
  sdkManagedTool?: boolean;
  /**
   * Gemini 3 reasoning signature. Required for subsequent function calling
   * turns when using models with reasoning/thinking enabled.
   */
  thoughtSignature?: string;
}

export interface ProviderAdapter {
  readonly provider: "anthropic" | "google" | "google-claude" | "local";
  readonly modelId: string;
  stream(
    sessionId: string,
    messages: CanonicalMessage[],
    systemPrompt: string,
    tools: readonly unknown[],
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk>;
}

// ─── Format converters ──────────────────────────────────────────────────────

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export function toOpenAIMessages(messages: CanonicalMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      result.push({ role: "system", content: m.content });
    } else if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      result.push({ role: "assistant", content: m.content });
    } else if (m.role === "tool_call") {
      const meta = m.metadata as { toolUseId?: string; toolName?: string; toolInput?: unknown };
      result.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: meta.toolUseId ?? `call_${Math.random().toString(36).substring(2, 9)}`,
          type: "function",
          function: {
            name: meta.toolName ?? "unknown",
            arguments: JSON.stringify(meta.toolInput ?? {}),
          },
        }],
      });
    } else if (m.role === "tool_result") {
      const meta = m.metadata as { toolUseId?: string; toolName?: string };
      result.push({
        role: "tool",
        tool_call_id: meta.toolUseId ?? "unknown",
        name: meta.toolName,
        content: m.content,
      });
    }
  }
  return result;
}

export function toAnthropicMessages(messages: CanonicalMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      result.push({ role: "assistant", content: m.content });
    } else if (m.role === "tool_call") {
      const meta = m.metadata as { toolUseId?: string; toolName?: string; toolInput?: unknown };
      if (!meta.toolUseId || !meta.toolName) throw new Error(`tool_call message missing toolUseId or toolName in metadata`);
      result.push({
        role: "assistant",
        content: [{ type: "tool_use", id: meta.toolUseId, name: meta.toolName, input: (meta.toolInput ?? {}) as Record<string, unknown> }],
      });
    } else if (m.role === "tool_result") {
      const meta = m.metadata as { toolUseId?: string; isError?: boolean };
      if (!meta.toolUseId) throw new Error(`tool_result message missing toolUseId in metadata`);
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
  let currentTurn: GeminiContent | null = null;

  for (const m of messages) {
    // Map canonical roles to Gemini roles
    // user/system* -> user
    // assistant/tool_call -> model
    // tool_result -> user
    const role: "user" | "model" = (m.role === "assistant" || m.role === "tool_call") ? "model" : "user";

    // If roles differ, start a new turn
    if (!currentTurn || currentTurn.role !== role) {
      currentTurn = { role, parts: [] };
      result.push(currentTurn);
    }

    if (m.role === "user") {
      currentTurn.parts.push({ text: m.content });
    } else if (m.role === "assistant") {
      currentTurn.parts.push({ text: m.content });
    } else if (m.role === "tool_call") {
      const meta = m.metadata as { toolName?: string; toolInput?: unknown; thoughtSignature?: string };
      if (!meta.toolName) throw new Error(`tool_call message missing toolName in metadata`);
      currentTurn.parts.push({
        functionCall: {
          name: meta.toolName,
          args: (meta.toolInput ?? {}) as Record<string, unknown>,
        },
        ...(meta.thoughtSignature ? { thoughtSignature: meta.thoughtSignature } : {}),
      });
    } else if (m.role === "tool_result") {
      const meta = m.metadata as { toolName?: string };
      if (!meta.toolName) throw new Error(`tool_result message missing toolName in metadata`);
      currentTurn.parts.push({
        functionResponse: {
          name: meta.toolName,
          response: { output: m.content }
        }
      });
    }
  }
  return result;
}

export function extractSystemPrompt(messages: CanonicalMessage[]): string {
  return messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n");
}

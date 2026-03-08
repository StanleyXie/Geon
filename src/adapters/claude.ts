/**
 * ClaudeAdapter
 *
 * Wraps @anthropic-ai/claude-agent-sdk's query() to produce NormalizedChunk
 * objects for the universal-agent-acp pipeline.
 *
 * Architecture note — why the SDK owns the tool loop:
 *   The Claude Agent SDK runs Claude's full agentic loop internally. Claude
 *   requests tools, the SDK executes them (using its own built-in tool
 *   implementations), and results are fed back — all inside query(). We
 *   cannot inject our own executor mid-loop.
 *
 *   Therefore this adapter:
 *     1. Passes GEON's tool names to the SDK via `tools` + `allowedTools`
 *        so Claude has access to the right set and all are auto-approved.
 *     2. Streams text chunks in real time via `stream_event` messages.
 *     3. Surfaces tool activity to the agentic loop via `tool_progress`
 *        events (NormalizedChunk type "tool_call") so the server can post
 *        tool_call / tool_call_update ACP notifications for the UI.
 *     4. Reports final usage from the `result` message.
 *
 * Conversation history:
 *   query() does not accept a message-history array. Each call is a fresh
 *   Claude Code session. Full multi-turn replay (via SDK `resume`) is a
 *   Phase 2 concern.
 */

import { execFileSync } from "node:child_process";
import {
  query,
  type Options,
  type SDKResultMessage,
  type SDKPartialAssistantMessage,
  type SDKAssistantMessage,
  type SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CanonicalMessage } from "../context/types.js";
import type { NormalizedChunk, ProviderAdapter } from "./types.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

// ---------------------------------------------------------------------------
// Resolve claude CLI path at module load time.
// In a compiled Bun binary import.meta.url is "bun:" so the SDK cannot
// auto-find cli.js – we must supply it explicitly.
// Priority: CLAUDE_EXECUTABLE_PATH env var → login-shell `which claude`.
// ---------------------------------------------------------------------------
const CLAUDE_CLI_PATH: string | undefined = (() => {
  const env = process.env["CLAUDE_EXECUTABLE_PATH"];
  if (env) return env;
  try {
    const shell = process.env["SHELL"] ?? "/bin/zsh";
    // execFileSync (not execSync) – shell is passed as a program path, never
    // interpolated into a shell command string, preventing injection if SHELL
    // is attacker-controlled.
    const result = execFileSync(shell, ["-l", "-c", "which claude 2>/dev/null"], {
      timeout: 5000,
      encoding: "utf8",
    }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
})();

// ---------------------------------------------------------------------------
// Tool names to expose to the SDK — derived from GEON's canonical tool list.
// ---------------------------------------------------------------------------
const TOOL_NAMES: string[] = BUILT_IN_TOOLS.map((t) => t.name);

// ---------------------------------------------------------------------------
// ClaudeAdapter
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly modelId: string;
  private apiKey?: string;

  constructor(modelId: string, options?: { apiKey?: string }) {
    this.modelId = modelId;
    this.apiKey = options?.apiKey;
  }

  private static startedSessions = new Set<string>();

  async *stream(
    sessionId: string,
    messages: CanonicalMessage[],
    systemPrompt: string,
    _tools: readonly unknown[],   // GEON's tool list — converted to SDK names above
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    // Determine context handling Strategy.
    // If we've already started this session in this process life, resume it.
    // Otherwise, since each ACP turn is a fresh Adapter call but the SDK
    // manages its own loop internally, we either:
    // 1. Start a new session with Zed's ID (first user message)
    // 2. Resume the session with Zed's ID (subsequent turns)
    const isResume = ClaudeAdapter.startedSessions.has(sessionId);
    ClaudeAdapter.startedSessions.add(sessionId);

    // Extract the latest user message as the prompt string.
    const latestUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const prompt = latestUserMsg?.content ?? "";

    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort(), { once: true });

    const options: Options = {
      model: this.modelId,
      systemPrompt: systemPrompt || undefined,

      // Expose GEON's tool set to Claude Code's built-in executor.
      tools: TOOL_NAMES,
      allowedTools: TOOL_NAMES,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,

      includePartialMessages: true,
      abortController,
      persistSession: true, // required for resume

      // Map Zed's sessionId to the SDK
      ...(isResume ? { resume: sessionId } : { sessionId }),

      // Route Claude Code's own stderr (debug/log) away from ACP stdout.
      stderr: (data: string) => process.stderr.write(data),

      // Explicit CLI path — required in compiled Bun binaries.
      ...(CLAUDE_CLI_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CLI_PATH } : {}),

      // Pass API Key if provided.
      env: {
        ...process.env,
        ...(this.apiKey ? { ANTHROPIC_API_KEY: this.apiKey } : {}),
      },
    };

    const q = query({ prompt, options });

    let resultUsage: SDKResultMessage["usage"] | null = null;

    try {
      for await (const msg of q) {
        if (signal.aborted) break;

        switch (msg.type) {

          // ---- Streaming text chunks from the model -----------------------
          case "stream_event": {
            const partial = msg as SDKPartialAssistantMessage;
            const event = partial.event;
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              yield { type: "text", text: event.delta.text };
            }
            break;
          }

          // ---- Tool progress — SDK is about to execute / has executed a tool.
          // Surfaced as tool_call with sdkManagedTool=true so the ACP server
          // posts UI notifications without re-executing the tool locally.
          // tool_progress fires first (no input yet); the assistant message
          // below carries the full input once the turn completes.
          case "tool_progress": {
            const tp = msg as SDKToolProgressMessage;
            yield {
              type: "tool_call",
              toolName: tp.tool_name,
              toolInput: {},            // not available at progress time
              toolUseId: tp.tool_use_id,
              sdkManagedTool: true,
            };
            break;
          }

          // ---- Complete assistant turn — tool_use blocks carry the full input.
          // Also sdkManagedTool=true: SDK already ran these, no local execution.
          case "assistant": {
            const am = msg as SDKAssistantMessage;
            for (const block of am.message.content) {
              if (block.type === "tool_use") {
                yield {
                  type: "tool_call",
                  toolName: block.name,
                  toolInput: block.input as Record<string, unknown>,
                  toolUseId: block.id,
                  sdkManagedTool: true,
                };
              }
            }
            break;
          }

          // ---- Final result — harvest accumulated usage -------------------
          case "result": {
            resultUsage = (msg as SDKResultMessage).usage;
            break;
          }

          // All other message types (user, system, status, task_*, etc.)
          // are not relevant for the normalized stream.
          default:
            break;
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      throw err;
    }

    yield {
      type: "done",
      inputTokens: resultUsage?.input_tokens ?? 0,
      outputTokens: resultUsage?.output_tokens ?? 0,
      cacheHitTokens: resultUsage?.cache_read_input_tokens ?? 0,
    };
  }
}

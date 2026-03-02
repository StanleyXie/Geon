/**
 * ClaudeAdapter
 *
 * Wraps @anthropic-ai/claude-agent-sdk's query() function to produce
 * NormalizedChunk objects for the universal-agent-acp pipeline.
 *
 * LIMITATION (Phase 1): The Claude Agent SDK's query() does not accept a full
 * message history array. It takes a single prompt string and manages its own
 * session/context internally via Claude Code's session persistence. As a result,
 * this adapter passes only the latest user message (extracted from messages[]) +
 * systemPrompt to query(). Full conversation replay would require either:
 *   (a) Using the SDK's `resume` option to continue a persisted Claude session, or
 *   (b) Injecting context via the systemPrompt string (context-stuffing workaround).
 * Phase 2 may address this via session ID threading into the Options.resume field.
 */

import { execFileSync } from "node:child_process";
import {
  query,
  type Options,
  type SDKResultMessage,
  type SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CanonicalMessage } from "../context/types.js";
import type { NormalizedChunk, ProviderAdapter } from "./types.js";

/**
 * Resolve the claude CLI executable path at module load time.
 * In a compiled Bun binary, import.meta.url returns a "bun:" URL so the SDK
 * cannot auto-detect cli.js. We must provide the path explicitly.
 * Priority: CLAUDE_EXECUTABLE_PATH env var → login shell `which claude`.
 */
const CLAUDE_CLI_PATH: string | undefined = (() => {
  const env = process.env["CLAUDE_EXECUTABLE_PATH"];
  if (env) return env;
  try {
    const shell = process.env["SHELL"] ?? "/bin/zsh";
    // Use execFileSync (not execSync) so `shell` is passed as a program path,
    // never interpolated into a shell command string — prevents injection if
    // SHELL env var is attacker-controlled.
    const result = execFileSync(shell, ["-l", "-c", "which claude 2>/dev/null"], {
      timeout: 5000,
      encoding: "utf8",
    }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
})();

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async *stream(
    messages: CanonicalMessage[],
    systemPrompt: string,
    _tools: readonly unknown[],
    signal: AbortSignal,
  ): AsyncIterable<NormalizedChunk> {
    // Extract latest user message. If none found, fall back to empty string.
    const latestUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const prompt = latestUserMsg?.content ?? "";

    const abortController = new AbortController();

    // Forward the external abort signal into the SDK's AbortController.
    signal.addEventListener("abort", () => abortController.abort(), { once: true });

    const options: Options = {
      model: this.modelId,
      systemPrompt: systemPrompt || undefined,
      // Disable tools: we are not running Claude Code's agentic tool loop.
      // We only want raw text generation via the SDK.
      tools: [],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      abortController,
      // Route Claude Code's own log output to stderr so it never pollutes stdout (ACP JSON-RPC).
      stderr: (data: string) => process.stderr.write(data),
      // Disable session persistence: each call is ephemeral in Phase 1.
      persistSession: false,
      // Explicit claude CLI path — required in compiled Bun binary because
      // import.meta.url resolves to "bun:" (not a filesystem path), so the SDK
      // cannot auto-locate cli.js via fileURLToPath(import.meta.url).
      ...(CLAUDE_CLI_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CLI_PATH } : {}),
    };

    const q = query({ prompt, options });

    let resultUsage: SDKResultMessage["usage"] | null = null;

    try {
      for await (const msg of q) {
        if (signal.aborted) break;

        switch (msg.type) {
          case "stream_event": {
            // SDKPartialAssistantMessage carries a BetaRawMessageStreamEvent.
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

          case "result": {
            // SDKResultMessage (success or error) carries accumulated usage.
            const result = msg as SDKResultMessage;
            resultUsage = result.usage;
            break;
          }

          // Remaining message types (user, assistant, system, tool_progress, etc.)
          // are not relevant for our normalized stream — skip them.
          default:
            break;
        }
      }
    } catch (err: unknown) {
      // If the abort caused the error, swallow it gracefully.
      if (signal.aborted) return;
      throw err;
    }

    // Emit the done chunk with usage counters.
    // NonNullableUsage fields are snake_case (confirmed from @anthropic-ai/claude-agent-sdk reference).
    yield {
      type: "done",
      inputTokens: resultUsage?.input_tokens ?? 0,
      outputTokens: resultUsage?.output_tokens ?? 0,
      cacheHitTokens: resultUsage?.cache_read_input_tokens ?? 0,
    };
  }
}

import {
  Agent, AgentSideConnection, ndJsonStream,
  type InitializeRequest, type InitializeResponse,
  type NewSessionRequest, type NewSessionResponse,
  type PromptRequest, type PromptResponse,
  type LoadSessionRequest, type LoadSessionResponse,
  type ListSessionsRequest, type ListSessionsResponse,
  type ResumeSessionRequest, type ResumeSessionResponse,
  type SetSessionConfigOptionRequest, type SetSessionConfigOptionResponse,
  type CancelNotification, type SessionConfigOption,
  type AuthenticateRequest, type AuthenticateResponse,
  type ToolKind, type ToolCallLocation,
} from "@agentclientprotocol/sdk";

import { ContextGraph } from "../context/graph.js";
import { MODEL_SPECS } from "../context/model-registry.js";
import { ModelSwitchAnalyzer } from "../context/switch-analyzer.js";
import { SessionManager } from "../session/manager.js";
import { randomUUID } from "node:crypto";
import type { HeaderLine, MessageLine, ModelSwitchLine, ToolCallLine, UsageLine } from "../session/types.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
import { executeToolCall } from "../tools/executor.js";
import { ClaudeAdapter } from "../adapters/claude.js";
import { GeminiAdapter } from "../adapters/gemini.js";
import { LocalModelAdapter } from "../adapters/local.js";
import type { ProviderAdapter } from "../adapters/types.js";
import { DEFAULT_SETTINGS, mergeSettings, type GeonSettings } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gemini-2.5-flash";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TOOL_ROUNDS = 20;

function assertValidSessionId(sessionId: string): void {
  if (!UUID_RE.test(sessionId)) {
    throw new Error("Invalid session ID");
  }
}

// ---------------------------------------------------------------------------
// Helpers: XML tool-call rendering
// Models operating in agentic mode sometimes emit <tool_call> / <tool_response>
// XML as plain text (not actual protocol tool-use events).  Convert them to
// readable markdown code blocks so they render cleanly in Zed.
// ---------------------------------------------------------------------------

function renderToolBlock(tag: string, content: string): string {
  const trimmed = content.trimEnd();
  if (tag === "tool_call") {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const label = typeof parsed["name"] === "string" ? parsed["name"] : "tool_call";
      const args = parsed["arguments"] ?? parsed;
      return `\`\`\`json\n// ${label}\n${JSON.stringify(args, null, 2)}\n\`\`\``;
    } catch {
      return `\`\`\`\n${trimmed}\n\`\`\``;
    }
  }
  // tool_response → blockquote
  const lines = trimmed.split("\n").map((l) => `> ${l}`).join("\n");
  return `> **Response:**\n${lines}`;
}

/** Batch transform for already-complete text (JSONL replay). */
function transformToolCallXml(text: string): string {
  let out = text.replace(
    /<tool_call>([\s\S]*?)<\/tool_call>/g,
    (_m, body: string) => renderToolBlock("tool_call", body),
  );
  out = out.replace(
    /<tool_response>([\s\S]*?)<\/tool_response>/g,
    (_m, body: string) => renderToolBlock("tool_response", body),
  );
  return out;
}

export function toolCallTitle(toolName: string, toolInput: any): string {
  const tool = BUILT_IN_TOOLS.find((t) => t.name === toolName);
  if (tool?.getTitle) return tool.getTitle(toolInput);

  switch (toolName) {
    case "Read": return `Read ${toolInput.path || "file"}`;
    case "Write": return `Write ${toolInput.path || "file"}`;
    case "Edit": return `Edit ${toolInput.path || "file"}`;
    case "Bash": return toolInput.command || "Terminal";
    case "Glob":
    case "Find": return `find ${toolInput.pattern || "*"}`;
    case "Grep": return `grep ${toolInput.pattern || "*"}`;
    case "LS": return `ls ${toolInput.path || "."}`;
    default: return toolName || "Tool Call";
  }
}

export function toolCallKind(toolName: string): ToolKind {
  const tool = BUILT_IN_TOOLS.find((t) => t.name === toolName);
  if (tool) return tool.kind;

  switch (toolName) {
    case "Read": return "read";
    case "Write": return "edit";
    case "Edit": return "edit";
    case "Bash": return "execute";
    case "Glob":
    case "Find": return "search";
    case "Grep": return "search";
    case "LS": return "search";
    case "WebFetch": return "fetch";
    case "WebSearch": return "fetch";
    default: return "other";
  }
}

export function toolCallLocations(toolName: string, toolInput: any): ToolCallLocation[] {
  const tool = BUILT_IN_TOOLS.find((t) => t.name === toolName);
  if (tool?.getLocations) return tool.getLocations(toolInput);

  const input = toolInput as Record<string, unknown> | undefined;
  const path = input?.["path"];
  if (typeof path === "string" && path &&
    (toolName === "Read" || toolName === "Write" || toolName === "Edit" || toolName === "LS")) {
    return [{ path }];
  }
  return [];
}

import type { ToolCallContent } from "@agentclientprotocol/sdk";

export function getToolCallContent(toolName: string, toolInput: any, resultText: string): ToolCallContent[] {
  switch (toolName) {
    case "Edit":
      return [{
        type: "diff",
        path: toolInput.path,
        oldText: toolInput.old_string,
        newText: toolInput.new_string,
      }];
    case "Write":
      return [{
        type: "diff",
        path: toolInput.path,
        oldText: null, // Full overwrite
        newText: toolInput.content,
      }];
    case "Bash":
      // Optional: Add terminal support if terminalId is available
      return [{ type: "content", content: { type: "text", text: `\`\`\`console\n${resultText}\n\`\`\`` } }];
    default:
      return [{ type: "content", content: { type: "text", text: resultText } }];
  }
}

import type { NormalizedChunk } from "../adapters/types.js";

/**
 * Line-buffered stream transformer.
 * Normal lines flow through immediately (preserving real-time streaming).
 * <tool_call> / <tool_response> multi-line blocks are buffered until the
 * closing tag is seen, then emitted as a single transformed markdown chunk.
 */
async function* transformStream(
  source: AsyncIterable<NormalizedChunk>,
): AsyncIterable<NormalizedChunk> {
  let lineBuf = "";   // incomplete trailing line waiting for next \n
  let xmlBuf = "";    // content accumulator while inside an XML block
  let xmlTag = "";    // "tool_call" | "tool_response" | "" (not in block)

  function processLine(line: string): string | null {
    if (!xmlTag) {
      // Detect opening tag on its own line: "<tool_call>" or "<tool_response>"
      const m = /^<(tool_call|tool_response)>\s*$/.exec(line.trim());
      if (m) { xmlTag = m[1]!; xmlBuf = ""; return null; }
      return line;
    }
    // Inside XML block — watch for closing tag
    if (line.trim() === `</${xmlTag}>`) {
      const rendered = renderToolBlock(xmlTag, xmlBuf) + "\n";
      xmlTag = ""; xmlBuf = "";
      return rendered;
    }
    xmlBuf += line;
    return null;
  }

  let isFirstTextChunk = true;

  function stripRoleMarkers(text: string): string {
    if (!isFirstTextChunk) return text;
    // Strip common role markers models sometimes hallucinate
    const stripped = text
      .replace(/^(Assistant|AI|Model):\s*/i, "")
      .replace(/^##\s*(Assistant|AI|Model)\s*\n?/i, "");
    if (stripped !== text) {
      isFirstTextChunk = false; // we processed the first chunk
      return stripped.trimStart();
    }
    if (text.trim().length > 0) {
      isFirstTextChunk = false;
    }
    return text;
  }

  for await (const chunk of source) {
    if (chunk.type !== "text") { yield chunk; continue; }

    const text = stripRoleMarkers(chunk.text || "");
    lineBuf += text;
    let nl: number;
    while ((nl = lineBuf.indexOf("\n")) !== -1) {
      const line = lineBuf.slice(0, nl + 1);
      lineBuf = lineBuf.slice(nl + 1);
      const out = processLine(line);
      if (out !== null) yield { type: "text", text: out };
    }
  }
  // Flush partial final line (no trailing \n)
  if (lineBuf) {
    const out = processLine(lineBuf);
    if (out !== null) yield { type: "text", text: out };
  }
  // Incomplete XML block at end-of-stream — emit as-is
  if (xmlTag && xmlBuf) {
    yield { type: "text", text: `<${xmlTag}>\n${xmlBuf}` };
  }
}

// ---------------------------------------------------------------------------
// Helper: makeModelConfigOptions
// ---------------------------------------------------------------------------

function makeModelConfigOptions(currentModel: string): SessionConfigOption[] {
  return [
    {
      type: "select" as const,
      id: "model",
      name: "Model",
      category: "model",
      currentValue: currentModel,
      options: Object.values(MODEL_SPECS).map((s) => ({
        value: s.id,
        name: s.displayName,
        description: `${(s.maxContext / 1_000_000).toFixed(0)}M context`,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// SessionState
// ---------------------------------------------------------------------------

interface SessionState {
  graph: ContextGraph;
  sessionManager: SessionManager;
  abortController: AbortController;
  configOptions: SessionConfigOption[];
  cwd: string;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCacheHitTokens: number;
}

// ---------------------------------------------------------------------------
// UniversalAcpAgent
// ---------------------------------------------------------------------------

export class UniversalAcpAgent implements Agent {
  private conn: AgentSideConnection;
  private sessions: Map<string, SessionState> = new Map();
  private settings: GeonSettings = DEFAULT_SETTINGS;

  constructor(conn: AgentSideConnection) {
    this.conn = conn;
  }

  // ---- initialize ----------------------------------------------------------

  async initialize(req: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: req.protocolVersion,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          list: {},
          resume: {},
        },
        configSettings: [
          {
            id: "google_api_key",
            name: "Google API Key",
            description: "Dedicated Google AI Studio API Key for Gemini",
            type: "string",
            isSecret: true,
          },
          {
            id: "google_enabled",
            name: "Enable Google",
            description: "Whether to enable Gemini provider",
            type: "boolean",
          },
          {
            id: "anthropic_api_key",
            name: "Anthropic API Key",
            description: "Dedicated Anthropic API Key for Claude",
            type: "string",
            isSecret: true,
          },
          {
            id: "anthropic_enabled",
            name: "Enable Anthropic",
            description: "Whether to enable Claude provider",
            type: "boolean",
          },
          {
            id: "local_enabled",
            name: "Enable Local",
            description: "Whether to enable local models",
            type: "boolean",
          },
          {
            id: "local_endpoint",
            name: "Local Endpoint",
            description: "OpenAI-compatible endpoint (e.g. http://localhost:8000/v1)",
            type: "string",
          },
          {
            id: "default_model",
            name: "Default Model",
            description: "The default model used for new sessions",
            type: "string",
          }
        ],
      } as any,
      agentInfo: {
        name: "Geon",
        version: "0.1.0",
      },
    };
  }

  // ---- authenticate --------------------------------------------------------

  async authenticate(_req: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  // ---- newSession ----------------------------------------------------------

  async newSession(req: NewSessionRequest): Promise<NewSessionResponse> {
    const cwd = req.cwd ?? process.cwd();
    const sessionManager = new SessionManager({ cwd });

    // Determine the starting model based on settings or req.sessionId
    const initialModel = this.settings.defaultModel ?? DEFAULT_MODEL;

    const graph = ContextGraph.create(initialModel);
    const sessionId = sessionManager.createSession(initialModel);
    const configOptions = makeModelConfigOptions(initialModel);

    this.sessions.set(sessionId, {
      graph,
      sessionManager,
      abortController: new AbortController(),
      configOptions,
      cwd,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionCacheHitTokens: 0,
    });

    return { sessionId, configOptions };
  }

  // ---- prompt --------------------------------------------------------------

  async prompt(req: PromptRequest): Promise<PromptResponse> {
    assertValidSessionId(req.sessionId);
    const state = this.sessions.get(req.sessionId);
    if (!state) throw new Error(`Session not found: ${req.sessionId}`);

    // Reset abort controller for this turn
    state.abortController = new AbortController();
    const signal = state.abortController.signal;

    // Extract text from prompt content blocks
    const userText = req.prompt
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? (b as { type: "text"; text: string }).text : ""))
      .join("");

    // Add user message to L1
    const node = state.graph.activeNode;
    node.addMessage("user", userText);

    // Persist to JSONL
    await state.sessionManager.appendMessage(req.sessionId, {
      role: "user",
      content: userText,
      parts: [{ text: userText }],
    });

    // Agentic loop: repeat until the model gives a response with no tool calls
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;
    let assistantText = "";   // final round's terminal text (preamble text from earlier rounds is flushed inline)
    let roundCount = 0;

    try {
      while (!signal.aborted) {
        roundCount++;
        if (roundCount > MAX_TOOL_ROUNDS) {
          // Safety: prevent runaway loops from misbehaving models
          await this.conn.sessionUpdate({
            sessionId: req.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "\n\n[WARNING] Tool call limit reached (max rounds exceeded).\n" },
            },
          });
          break;
        }
        const payload = node.engine.prepare();
        const adapter = this.makeAdapter(node.store.modelId);
        let toolCallsMadeThisRound = false;
        let roundText = "";   // text emitted by the model in this round

        for await (const chunk of transformStream(
          adapter.stream(req.sessionId, payload.messages, "", BUILT_IN_TOOLS, signal),
        )) {
          if (signal.aborted) break;

          if (chunk.type === "text" && chunk.text) {
            roundText += chunk.text;
            fullText += chunk.text;
            await this.conn.sessionUpdate({
              sessionId: req.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: chunk.text },
              },
            });
          } else if (chunk.type === "tool_call" && chunk.toolName) {
            toolCallsMadeThisRound = true;
            const toolUseId = chunk.toolUseId ?? randomUUID();
            const title = toolCallTitle(chunk.toolName, chunk.toolInput);
            const kind = toolCallKind(chunk.toolName);
            const locations = toolCallLocations(chunk.toolName, chunk.toolInput);

            if (chunk.sdkManagedTool) {
              // ── SDK-managed tool (ClaudeAdapter) ────────────────────────
              // The Claude Agent SDK already executed this tool remotely.
              // We only emit ACP notifications for UI observability — no
              // local executeToolCall, no L1/JSONL writes (the SDK owns the
              // result and will include it in the next assistant turn).
              await this.conn.sessionUpdate({
                sessionId: req.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: toolUseId,
                  title,
                  kind,
                  status: "completed",
                  rawInput: chunk.toolInput,
                  ...(locations.length > 0 ? { locations } : {}),
                },
              });
            } else {
              // ── Locally-executed tool (GeminiAdapter / ProxyClaudeAdapter)
              // Emit pending notification, run the tool, then report result.

              await this.conn.sessionUpdate({
                sessionId: req.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: toolUseId,
                  title,
                  kind,
                  status: "pending",
                  rawInput: chunk.toolInput,
                  ...(locations.length > 0 ? { locations } : {}),
                },
              });

              // Execute the tool locally
              let resultText: string;
              let isError = false;
              try {
                resultText = await executeToolCall(
                  chunk.toolName,
                  chunk.toolInput as Record<string, unknown>,
                  state.cwd,
                );
              } catch (err: unknown) {
                resultText = `Error: ${(err as Error).message}`;
                isError = true;
              }

              // Report result
              await this.conn.sessionUpdate({
                sessionId: req.sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: toolUseId,
                  status: isError ? "failed" : "completed",
                  rawOutput: resultText,
                  content: getToolCallContent(chunk.toolName, chunk.toolInput, resultText),
                },
              });

              // Flush any preceding text as a separate assistant message
              if (roundText) {
                node.addMessage("assistant", roundText);
                await state.sessionManager.appendMessage(req.sessionId, {
                  role: "model",
                  content: roundText,
                  parts: [{ text: roundText }],
                });
                roundText = "";
              }

              // Record tool_call + tool_result in L1 context
              const toolLabel = `${chunk.toolName}(${toolCallTitle(chunk.toolName, chunk.toolInput)})`;
              node.addMessage("tool_call", toolLabel, {
                toolUseId,
                toolName: chunk.toolName,
                toolInput: chunk.toolInput,
                thoughtSignature: chunk.thoughtSignature,
              });
              node.addMessage("tool_result", resultText, {
                toolUseId,
                toolName: chunk.toolName,
                isError,
              });

              // Persist to JSONL
              const toolCallLine: ToolCallLine = {
                type: "tool_call",
                toolName: chunk.toolName,
                input: chunk.toolInput,
                result: resultText,
                thoughtSignature: chunk.thoughtSignature,
                isError,
                uuid: toolUseId,
                timestamp: Date.now(),
              };
              await state.sessionManager.appendLine(req.sessionId, toolCallLine);
            }

          } else if (chunk.type === "done") {
            inputTokens += chunk.inputTokens ?? 0;
            outputTokens += chunk.outputTokens ?? 0;
            cacheHitTokens += chunk.cacheHitTokens ?? 0;
          }
        }

        if (!toolCallsMadeThisRound || signal.aborted) {
          assistantText = roundText;   // final model text
          break;
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return { stopReason: "cancelled" };

      // Instead of throwing and causing an "Internal Error" in Zed,
      // report the error as a model chunk so the user can see what happened.
      const errorMsg = (err as any)?.message || String(err);
      await this.conn.sessionUpdate({
        sessionId: req.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n\n> [!CAUTION]\n> **Model Error:** ${errorMsg}\n>\n> This turn failed. You may want to wait a few seconds or try switching to a different model in the config.`
          },
        },
      });

      // We don't throw here, allowing the session to remain alive
      return { stopReason: "end_turn" };
    }

    if (signal.aborted) return { stopReason: "cancelled" };

    // Add final assistant response to L1 and JSONL
    node.addMessage("assistant", assistantText);
    await state.sessionManager.appendMessage(req.sessionId, {
      role: "model",
      content: assistantText,
      parts: [{ text: assistantText }],
    });

    // Accumulate session token totals
    state.sessionInputTokens += inputTokens;
    state.sessionOutputTokens += outputTokens;
    state.sessionCacheHitTokens += cacheHitTokens;

    // Persist per-turn usage line to JSONL
    const usageLine: UsageLine = {
      type: "usage",
      inputTokens,
      outputTokens,
      cacheHitTokens,
      timestamp: Date.now(),
    };
    await state.sessionManager.appendUsageLine(req.sessionId, usageLine);

    // Send usage update: used = L1 context window fill
    const snapshot = node.store.snapshot();
    await this.conn.sessionUpdate({
      sessionId: req.sessionId,
      update: {
        sessionUpdate: "usage_update",
        used: snapshot.totalTokens,
        size: snapshot.contextLimit,
        cost: { amount: 0, currency: "USD" },
      },
    });

    // Append inline token stats as trailing text chunk
    // Use fullText for code-block detection since it includes tool labels
    const fmt = (n: number) => n.toLocaleString("en-US");
    const hitPct = (hit: number, total: number) =>
      total > 0 && hit > 0 ? ` (${Math.round((hit / total) * 100)}%)` : "";
    const turnCache = cacheHitTokens > 0
      ? `${fmt(cacheHitTokens)}⚡${hitPct(cacheHitTokens, inputTokens)}`
      : "—";
    const sessCache = state.sessionCacheHitTokens > 0
      ? `${fmt(state.sessionCacheHitTokens)}⚡${hitPct(state.sessionCacheHitTokens, state.sessionInputTokens)}`
      : "—";
    const openCodeBlock = (() => {
      let inside = false;
      for (const line of fullText.split("\n")) {
        if (line.startsWith("```")) inside = !inside;
      }
      return inside ? "```\n" : "";
    })();
    const statsText = [
      `\n\n${openCodeBlock}`,
      `---`,
      `◈ Token Statistic`,
      `| | ↑ Input | ↓ Output | ⚡ Cache Hit |`,
      `|---|---:|---:|---:|`,
      `| **Turn** | ${fmt(inputTokens)} | ${fmt(outputTokens)} | ${turnCache} |`,
      `| **Session** | ${fmt(state.sessionInputTokens)} | ${fmt(state.sessionOutputTokens)} | ${sessCache} |`,
    ].join("\n");
    await this.conn.sessionUpdate({
      sessionId: req.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: statsText },
      },
    });

    const turnTotal = inputTokens + outputTokens + cacheHitTokens;
    return {
      stopReason: "end_turn",
      usage: {
        inputTokens,
        outputTokens,
        cachedReadTokens: cacheHitTokens,
        cachedWriteTokens: 0,
        totalTokens: turnTotal,
      },
    };
  }

  // ---- loadSession ---------------------------------------------------------

  async loadSession(req: LoadSessionRequest): Promise<LoadSessionResponse> {
    assertValidSessionId(req.sessionId);
    const cwd = req.cwd ?? process.cwd();
    let sessionManager = new SessionManager({ cwd });
    let lines = await sessionManager.readLines(req.sessionId);

    // Find header to get modelId and authoritative cwd
    const header = lines.find((l): l is HeaderLine => l.type === "header");
    // If the header records a different cwd than req.cwd (e.g. cross-project load),
    // re-read using the header's cwd so the JSONL path resolves correctly.
    if (header && header.cwd !== cwd) {
      sessionManager = new SessionManager({ cwd: header.cwd });
      lines = await sessionManager.readLines(req.sessionId);
    }
    const modelId = header?.model ?? DEFAULT_MODEL;

    // Reconstruct ContextGraph and replay message history into L1
    const graph = ContextGraph.create(modelId);
    const node = graph.activeNode;

    for (const line of lines) {
      if (line.type === "message") {
        const ml = line as MessageLine;
        // Map "model" role to "assistant" for ContextNode.addMessage
        const role: "user" | "assistant" =
          ml.role === "model" ? "assistant" : "user";
        node.addMessage(role, ml.content);
      } else if (line.type === "tool_call") {
        const tl = line as ToolCallLine;
        node.addMessage("tool_call", `${tl.toolName}(${toolCallTitle(tl.toolName, tl.input)})`, {
          toolUseId: tl.uuid,
          toolName: tl.toolName,
          toolInput: tl.input,
          thoughtSignature: tl.thoughtSignature,
        });
        node.addMessage("tool_result", String(tl.result ?? ""), {
          toolUseId: tl.uuid,
          toolName: tl.toolName,
          isError: tl.isError,
        });
      }
    }

    const configOptions = makeModelConfigOptions(modelId);

    // Restore session cumulative totals from dedicated usage file
    const usageLines = await sessionManager.readUsageLines(req.sessionId);
    let sessionInputTokens = 0;
    let sessionOutputTokens = 0;
    let sessionCacheHitTokens = 0;
    for (const u of usageLines) {
      sessionInputTokens += u.inputTokens;
      sessionOutputTokens += u.outputTokens;
      sessionCacheHitTokens += u.cacheHitTokens;
    }

    this.sessions.set(req.sessionId, {
      graph,
      sessionManager,
      abortController: new AbortController(),
      configOptions,
      cwd,
      sessionInputTokens,
      sessionOutputTokens,
      sessionCacheHitTokens,
    });

    // Replay history to client via sessionUpdate notifications
    for (const line of lines) {
      if (line.type === "message") {
        const ml = line as MessageLine;
        const text = ml.content;
        if (!text) continue;

        if (ml.role === "user") {
          await this.conn.sessionUpdate({
            sessionId: req.sessionId,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text },
            },
          });
        } else if (ml.role === "model") {
          await this.conn.sessionUpdate({
            sessionId: req.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: transformToolCallXml(text) },
            },
          });
        }
      } else if (line.type === "tool_call") {
        const tl = line as ToolCallLine;
        const title = toolCallTitle(tl.toolName, tl.input);
        const kind = toolCallKind(tl.toolName);
        const locations = toolCallLocations(tl.toolName, tl.input);
        const resultText = String(tl.result ?? "");
        await this.conn.sessionUpdate({
          sessionId: req.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: tl.uuid,
            title,
            kind,
            status: tl.isError ? "failed" : "completed",
            rawInput: tl.input,
            rawOutput: tl.result,
            content: resultText
              ? [{ type: "content" as const, content: { type: "text" as const, text: resultText } }]
              : [],
            ...(locations.length > 0 ? { locations } : {}),
          },
        });
      }
    }

    return { configOptions };
  }

  // ---- unstable_resumeSession ----------------------------------------------

  async unstable_resumeSession(
    req: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    assertValidSessionId(req.sessionId);
    const cwd = req.cwd ?? process.cwd();
    let sessionManager = new SessionManager({ cwd });
    let lines = await sessionManager.readLines(req.sessionId);

    const header = lines.find((l): l is HeaderLine => l.type === "header");
    if (header && header.cwd !== cwd) {
      sessionManager = new SessionManager({ cwd: header.cwd });
      lines = await sessionManager.readLines(req.sessionId);
    }
    const modelId = header?.model ?? DEFAULT_MODEL;

    // Reconstruct ContextGraph and replay message history into L1
    const graph = ContextGraph.create(modelId);
    const node = graph.activeNode;

    for (const line of lines) {
      if (line.type === "message") {
        const ml = line as MessageLine;
        const role: "user" | "assistant" =
          ml.role === "model" ? "assistant" : "user";
        node.addMessage(role, ml.content);
      } else if (line.type === "tool_call") {
        const tl = line as ToolCallLine;
        node.addMessage("tool_call", `${tl.toolName}(${toolCallTitle(tl.toolName, tl.input)})`, {
          toolUseId: tl.uuid,
          toolName: tl.toolName,
          toolInput: tl.input,
        });
        node.addMessage("tool_result", String(tl.result ?? ""), {
          toolUseId: tl.uuid,
          toolName: tl.toolName,
          isError: tl.isError,
        });
      }
    }

    const configOptions = makeModelConfigOptions(modelId);

    // Restore session cumulative totals from dedicated usage file
    const usageLines = await sessionManager.readUsageLines(req.sessionId);
    let sessionInputTokens = 0;
    let sessionOutputTokens = 0;
    let sessionCacheHitTokens = 0;
    for (const u of usageLines) {
      sessionInputTokens += u.inputTokens;
      sessionOutputTokens += u.outputTokens;
      sessionCacheHitTokens += u.cacheHitTokens;
    }

    this.sessions.set(req.sessionId, {
      graph,
      sessionManager,
      abortController: new AbortController(),
      configOptions,
      cwd,
      sessionInputTokens,
      sessionOutputTokens,
      sessionCacheHitTokens,
    });

    // No history replay — silent restore
    return { configOptions };
  }

  // ---- unstable_listSessions -----------------------------------------------

  async unstable_listSessions(
    req: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const cwd = req.cwd ?? process.cwd();
    const sessionManager = new SessionManager({ cwd });
    const summaries = await sessionManager.listSessions();

    return {
      sessions: summaries.map((s) => ({
        sessionId: s.id,
        cwd: s.cwd,
        title: s.firstMessage || null,
        updatedAt: new Date(s.updatedAt).toISOString(),
      })),
    };
  }

  // ---- setSessionConfigOption ----------------------------------------------

  async setSessionConfigOption(
    req: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    assertValidSessionId(req.sessionId);
    const state = this.sessions.get(req.sessionId);
    if (!state) throw new Error(`Session not found: ${req.sessionId}`);

    if (req.configId === "model") {
      const newModelId = req.value as string;
      if (!MODEL_SPECS[newModelId]) {
        throw new Error(`Unknown model: ${newModelId}`);
      }
      const node = state.graph.activeNode;

      // Analyze switch impact (for logging / future use)
      const _analyzer = new ModelSwitchAnalyzer(node.store, node.l2, node.l3);
      const fromModelId = node.store.modelId;

      // Apply model switch to L1/L2/L3
      node.switchModel(newModelId);

      // Append model_switch line to JSONL
      const switchLine: ModelSwitchLine = {
        type: "model_switch",
        fromModel: fromModelId,
        toModel: newModelId,
        timestamp: Date.now(),
      };
      await state.sessionManager.appendLine(req.sessionId, switchLine);

      // Update stored config options
      state.configOptions = makeModelConfigOptions(newModelId);
    }

    return { configOptions: state.configOptions };
  }

  // ---- cancel --------------------------------------------------------------

  async cancel(req: CancelNotification): Promise<void> {
    if (!UUID_RE.test(req.sessionId)) return;
    const state = this.sessions.get(req.sessionId);
    if (!state) return;
    state.abortController.abort();
  }

  // ---- extension stubs -----------------------------------------------------

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === "set_agent_config") {
      process.stderr.write(`[GEON] set_agent_config received: ${JSON.stringify(params)}\n`);
      this.settings = mergeSettings(this.settings, params);
      process.stderr.write(`[GEON] current settings: ${JSON.stringify(this.settings)}\n`);
      return {};
    }
    return {};
  }

  async extNotification(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (method === "set_agent_config") {
      process.stderr.write(`[GEON] set_agent_config received: ${JSON.stringify(params)}\n`);
      this.settings = mergeSettings(this.settings, params);
      process.stderr.write(`[GEON] current settings: ${JSON.stringify(this.settings)}\n`);
    }
  }

  // ---- private helpers -----------------------------------------------------

  private makeAdapter(modelId: string): ProviderAdapter {
    const spec = MODEL_SPECS[modelId];
    if (!spec) throw new Error(`No adapter for model: ${modelId}`);

    const providerConfig = this.settings.providers[spec.provider];
    process.stderr.write(`[GEON] makeAdapter for ${modelId}, provider: ${spec.provider}, config: ${JSON.stringify(providerConfig)}\n`);

    if (providerConfig && !providerConfig.enabled) {
      throw new Error(`Provider for ${modelId} (${spec.provider}) is disabled in settings.`);
    }

    if (spec.provider === "anthropic") {
      return new ClaudeAdapter(modelId, { apiKey: providerConfig?.apiKey });
    }
    if ((spec.provider as any) === "local") {
      return new LocalModelAdapter(modelId, {
        endpoint: (providerConfig?.parameters?.endpoint as string) || "http://localhost:8000/v1",
        apiKey: providerConfig?.apiKey
      });
    }
    return new GeminiAdapter(modelId, { apiKey: providerConfig?.apiKey });
  }
}

// ---------------------------------------------------------------------------
// runAcp — wire AgentSideConnection to stdio
// Direction: stdout = ACP writes (agent output); stdin = ACP reads (client input)
// ---------------------------------------------------------------------------

export function runAcp(): void {
  // ndJsonStream(output: WritableStream, input: ReadableStream)
  // Agent writes to stdout (client reads), agent reads from stdin (client writes)
  const stdoutWriter = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        process.stdout.write(Buffer.from(chunk), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  });

  const stdinReader = new ReadableStream<Uint8Array>({
    start(controller) {
      process.stdin.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk)),
      );
      process.stdin.on("end", () => controller.close());
      process.stdin.on("error", (err) => controller.error(err));
    },
  });

  const stream = ndJsonStream(stdoutWriter, stdinReader);
  new AgentSideConnection((conn) => new UniversalAcpAgent(conn), stream);
}

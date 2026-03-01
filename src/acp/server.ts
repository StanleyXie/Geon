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
} from "@agentclientprotocol/sdk";

import { ContextGraph } from "../context/graph.js";
import { MODEL_SPECS } from "../context/model-registry.js";
import { ModelSwitchAnalyzer } from "../context/switch-analyzer.js";
import { SessionManager } from "../session/manager.js";
import type { HeaderLine, MessageLine, ModelSwitchLine, UsageLine } from "../session/types.js";
import { ClaudeAdapter } from "../adapters/claude.js";
import { GeminiAdapter } from "../adapters/gemini.js";
import { ProxyClaudeAdapter } from "../adapters/proxy-claude.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gemini-2.5-flash";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  for await (const chunk of source) {
    if (chunk.type !== "text") { yield chunk; continue; }
    lineBuf += chunk.text;
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
// Helper: makeAdapter
// ---------------------------------------------------------------------------

function makeAdapter(modelId: string): ClaudeAdapter | GeminiAdapter | ProxyClaudeAdapter {
  const spec = MODEL_SPECS[modelId];
  if (!spec) throw new Error(`No adapter for model: ${modelId}`);
  if (spec.provider === "anthropic") return new ClaudeAdapter(modelId);
  if (spec.provider === "google-claude") return new ProxyClaudeAdapter(spec.apiModelId ?? modelId);
  return new GeminiAdapter(modelId);
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
      },
      agentInfo: {
        name: "GEON",
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
    const graph = ContextGraph.create(DEFAULT_MODEL);
    const sessionId = sessionManager.createSession(DEFAULT_MODEL);
    const configOptions = makeModelConfigOptions(DEFAULT_MODEL);

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

    // Prepare payload via StrategyEngine
    const payload = node.engine.prepare();
    const adapter = makeAdapter(node.store.modelId);

    // Stream from provider through line-buffered XML transformer.
    // Normal lines flow to client immediately; <tool_call>/<tool_response> blocks
    // are held until the closing tag arrives, then emitted as markdown.
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;

    try {
      for await (const chunk of transformStream(
        adapter.stream(payload.messages, "", [], signal),
      )) {
        if (signal.aborted) break;

        if (chunk.type === "text" && chunk.text) {
          fullText += chunk.text;
          await this.conn.sessionUpdate({
            sessionId: req.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: chunk.text },
            },
          });
        } else if (chunk.type === "done") {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
          cacheHitTokens = chunk.cacheHitTokens ?? 0;
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw err;
    }

    if (signal.aborted) {
      return { stopReason: "cancelled" };
    }

    // Add assistant response to L1
    node.addMessage("assistant", fullText);

    // Persist assistant message to JSONL
    await state.sessionManager.appendMessage(req.sessionId, {
      role: "model",
      content: fullText,
      parts: [{ text: fullText }],
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
    const fmt = (n: number) => n.toLocaleString("en-US");
    const hitPct = (hit: number, total: number) =>
      total > 0 && hit > 0 ? ` (${Math.round((hit / total) * 100)}%)` : "";
    const turnCache = cacheHitTokens > 0
      ? `${fmt(cacheHitTokens)}⚡${hitPct(cacheHitTokens, inputTokens)}`
      : "—";
    const sessCache = state.sessionCacheHitTokens > 0
      ? `${fmt(state.sessionCacheHitTokens)}⚡${hitPct(state.sessionCacheHitTokens, state.sessionInputTokens)}`
      : "—";
    // If the response was truncated mid-code-block, close it before the stats block.
    // Parse line-by-line: a fenced code block opens/closes only when ``` starts a line.
    // Simple count is unreliable when ``` appears in inline text (e.g., markdown explanations).
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
        updatedAt: new Date(s.createdAt).toISOString(),
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
    _method: string,
    _params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return {};
  }

  async extNotification(
    _method: string,
    _params: Record<string, unknown>,
  ): Promise<void> {
    // no-op
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

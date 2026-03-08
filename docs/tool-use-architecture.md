# GEON Tool Use Architecture

> **Last updated:** 2025-07  
> **Scope:** `src/tools/`, `src/adapters/`, `src/acp/server.ts`

---

## Overview

GEON supports two primary AI provider backends — **Gemini** and **ClaudeAdapter** (Claude via Claude Agent SDK CLI). Each provider has a fundamentally different relationship with tool calling, driven by whether the provider's own runtime manages tool execution or GEON does.

This document captures the architecture, the two categories of tool execution, and the exact data flow for each.

---

## The Two Categories of Tool Execution

### Category 1 — GEON-Managed (Local Execution)

> **Provider:** `GeminiAdapter`

The model requests a tool call in its API response. GEON's agentic loop in `server.ts` intercepts the request, **executes the tool locally** via `executeToolCall()`, and feeds the result back to the model in the next API round-trip. The loop continues until the model produces a response with no tool calls.

```
┌─────────────┐   stream()  ┌─────────────────┐
│   Adapter   │ ──────────► │   server.ts      │
│  (stateless)│ ◄────────── │  agentic loop    │
└─────────────┘  messages[] │                  │
       ▲                    │  executeToolCall()│
       │                    │  ↓ local executor │
       │ next round-trip    │  node.addMessage()│
       └────────────────────│  JSONL persist    │
                            └─────────────────-─┘
```

**Sequence per tool call:**
1. Adapter yields `{ type: "tool_call", toolName, toolInput, toolUseId }`
2. Server emits ACP `tool_call` notification with `status: "pending"`
3. Server calls `executeToolCall(name, input, cwd)` — runs locally in GEON's process
4. Server emits ACP `tool_call_update` with `status: "completed" | "failed"` + result text
5. Server writes `tool_call` + `tool_result` messages to L1 (`ClientContextStore`)
6. Server appends `ToolCallLine` to JSONL session file
7. Loop continues — next `adapter.stream()` call receives the full updated message history

**What the adapter sees:** The full canonical message history including all prior tool calls and their results, properly formatted for the provider (Gemini `functionCall`/`functionResponse` parts).

---

### Category 2 — SDK-Managed (Remote Execution)

> **Provider:** `ClaudeAdapter` (via `@anthropic-ai/claude-agent-sdk`)

The Claude Agent SDK runs Claude's **complete agentic tool loop internally**, inside `query()`. Claude requests tools, the SDK executes them using its own built-in implementations (including remote-capable tools like `WebSearch`), and results are fed back to Claude — all without GEON's involvement. GEON receives only the final streamed text output and observability events.

```
┌──────────────────────────────────────────────┐
│           Claude Agent SDK (query())          │
│                                               │
│   Claude ◄──► Tool Executor ◄──► claude CLI  │
│      ↕ (internal multi-turn loop)             │
│   text chunks + tool_progress events          │
└────────────────────┬─────────────────────────┘
                     │ NormalizedChunks
                     ▼
           ┌─────────────────┐
           │   server.ts     │
           │  (observe only) │
           │  ACP notify UI  │
           └─────────────────┘
```

**Sequence per tool call:**
1. SDK emits `tool_progress` event → adapter yields `{ type: "tool_call", sdkManagedTool: true, toolName, toolUseId, toolInput: {} }`
2. SDK emits `assistant` message when the turn ends → adapter yields `{ type: "tool_call", sdkManagedTool: true, toolName, toolInput: <full input>, toolUseId }`
3. Server sees `sdkManagedTool: true` → emits ACP `tool_call` notification with `status: "completed"` immediately (no pending → execution → completed sequence)
4. Server does **NOT** call `executeToolCall()` — the SDK already ran it
5. Server does **NOT** write to L1 or JSONL — the SDK owns the conversation state internally
6. No next `adapter.stream()` call needed — the SDK's loop is self-contained; `query()` returns the full final text

**Why the SDK owns the loop:** The Claude Agent SDK's `query()` function is not a raw API wrapper. It spawns the `claude` CLI as a subprocess, which manages its own session, context window, and tool execution environment. Injecting intermediate results from GEON's executor would corrupt the SDK's internal state.

---

## The `sdkManagedTool` Flag

The `NormalizedChunk` interface carries a `sdkManagedTool?: boolean` field that is the critical branch point in `server.ts`:

```typescript
// src/adapters/types.ts
export interface NormalizedChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  sdkManagedTool?: boolean;  // ← true = SDK ran it; false/undefined = GEON runs it
  // ...
}
```

In `server.ts` the agentic loop branches on this flag:

```typescript
if (chunk.sdkManagedTool) {
  // Report to UI only — no local execution, no L1/JSONL writes
  await this.conn.sessionUpdate({ ..., status: "completed" });
} else {
  // Execute locally, write to L1, persist to JSONL, feed result back
  await this.conn.sessionUpdate({ ..., status: "pending" });
  const result = await executeToolCall(...);
  // L1 + JSONL + next round-trip...
}
```

---

## Tool Definitions and the Local Executor

Both categories share the same **tool schema definitions** (`src/tools/definitions.ts`), but only Category 1 uses the **local executor** (`src/tools/executor.ts`).

### GEON's Built-in Tool Set

| Tool | Category | Description |
|---|---|---|
| `Read` | File I/O | Read file contents, supports offset + limit |
| `Write` | File I/O | Create or overwrite a file |
| `Edit` | File I/O | Exact-string replacement in a file |
| `Bash` | Shell | Execute a shell command via `execFile` |
| `Glob` | Search | Find files by glob pattern |
| `Grep` | Search | Regex search across file contents |
| `LS` | File I/O | List directory contents |
| `WebFetch` | Network | Fetch a URL, strip HTML to plain text |
| `WebSearch` | Network | Web search via Brave / Serper / DuckDuckGo |

### Provider Tool Format Conversion

Tool definitions are written once in JSON Schema format and converted per provider:

```
BUILT_IN_TOOLS (ToolDefinition[])
    │
    └── toGeminiTools()      → FunctionDeclaration[]   (GeminiAdapter)
```

`ClaudeAdapter` passes tool names as `string[]` to the SDK (`tools: TOOL_NAMES`) — the SDK maps these to its own built-in tool implementations. No schema conversion is needed.

---

## Provider Comparison Table

| Aspect | GeminiAdapter | ClaudeAdapter |
|---|---|---|
| **Provider** | `google` | `anthropic` |
| **API** | `@google/genai` generateContentStream | `@anthropic-ai/claude-agent-sdk` query() |
| **Tool loop owner** | GEON `server.ts` | Claude Agent SDK |
| **Tool execution** | `executeToolCall()` locally | SDK CLI internally |
| **Accepts full history** | ✅ Yes | ❌ No (latest prompt only) |
| **`sdkManagedTool`** | `false` / unset | `true` |
| **L1 + JSONL writes** | Per tool call | Skipped |
| **WebSearch support** | ✅ GEON executor | ✅ SDK built-in |
| **Tool detection signal** | `functionCall` parts in stream | `tool_progress` + `assistant` messages |

---

## Data Flow Diagrams

### Category 1 — Full GEON-Managed Loop (Gemini)

```
User prompt
    │
    ▼
node.addMessage("user", ...)
    │
    ▼
┌─────────────────── while loop ──────────────────────┐
│                                                      │
│  adapter.stream(messages, "", tools, signal)         │
│       │                                              │
│       ├── NormalizedChunk { type: "text" }           │
│       │       └── ACP agent_message_chunk ──► Zed   │
│       │                                              │
│       ├── NormalizedChunk { type: "tool_call",       │
│       │       sdkManagedTool: false }                │
│       │       ├── ACP tool_call (pending) ──► Zed   │
│       │       ├── executeToolCall() locally          │
│       │       ├── ACP tool_call_update ──► Zed      │
│       │       ├── node.addMessage("tool_call", ...)  │
│       │       └── node.addMessage("tool_result", ...)│
│       │                                              │
│       └── NormalizedChunk { type: "done" }           │
│               └── accumulate tokens                  │
│                                                      │
│  if toolCallsMadeThisRound → continue loop           │
│  else → break                                        │
└──────────────────────────────────────────────────────┘
    │
    ▼
node.addMessage("assistant", finalText)
JSONL persist + ACP usage_update ──► Zed
```

### Category 2 — SDK-Managed Loop (ClaudeAdapter)

```
User prompt
    │
    ▼
query({ prompt: latestUserMessage, options: { tools: TOOL_NAMES, ... } })
    │
    ├── SDK internal loop:
    │       Claude ◄──► Built-in tool executor
    │       (WebSearch, Read, Bash, etc. — all SDK-native)
    │
    ├── stream_event (text delta)
    │       └── NormalizedChunk { type: "text" }
    │               └── ACP agent_message_chunk ──► Zed
    │
    ├── tool_progress event
    │       └── NormalizedChunk { type: "tool_call", sdkManagedTool: true, toolInput: {} }
    │               └── ACP tool_call (completed) ──► Zed  [observability only]
    │
    ├── assistant message (full BetaMessage)
    │       └── NormalizedChunk { type: "tool_call", sdkManagedTool: true, toolInput: <full> }
    │               └── ACP tool_call (completed) ──► Zed  [richer input visible]
    │
    └── result message
            └── NormalizedChunk { type: "done", inputTokens, outputTokens, ... }
```

---

## Why No L1 / JSONL Writes for SDK-Managed Tools

For `ClaudeAdapter`, GEON skips writing tool interactions to the L1 context store and JSONL session file for two reasons:

1. **State ownership:** The Claude Agent SDK persists its own conversation state inside the `claude` CLI session. The session's JSONL transcript (under `~/.claude/projects/`) is the authoritative record. Writing a parallel record in GEON's `~/.geon/` store would create a desynchronised duplicate.

2. **Context corruption:** If GEON were to write tool call / result messages into L1 and pass that history to a subsequent `query()` call, the Claude CLI would see an alien message history that contradicts its own internal state. This would cause either an error or severely confused model behaviour.

Since `query()` receives only the latest user prompt (not a full message history), GEON's L1 store is not used for history replay with the Claude adapter. Multi-turn continuity for `ClaudeAdapter` is a Phase 2 concern, to be addressed via the SDK's `resume` option.

---

## Adding a New Tool

1. **Add the definition** to `BUILT_IN_TOOLS` in `src/tools/definitions.ts`
2. **Add the executor** case in `executeToolCall()` in `src/tools/executor.ts`
3. **Add UI helpers** (`toolCallTitle`, `toolCallKind`, `toolCallLocations`) in `src/acp/server.ts`
4. **No adapter changes needed** — `toGeminiTools()` and `toAnthropicTools()` convert automatically
5. **For ClaudeAdapter:** add the tool name to `TOOL_NAMES` (derived automatically from `BUILT_IN_TOOLS`)

Tools that require network access or privileged APIs and cannot run locally should be **omitted from the local executor** and left exclusively to the SDK (for `ClaudeAdapter`) or the provider's remote execution environment. Document this in the tool's definition description.

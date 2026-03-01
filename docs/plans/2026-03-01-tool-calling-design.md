# GEON Tool Calling Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Add a Claude Code-aligned minimum toolset to GEON with native per-provider tool calling for GeminiAdapter and ProxyClaudeAdapter, driven by a server-side agentic loop.

**Architecture:** Server manages the multi-turn tool loop; adapters remain stateless single-API-call translators that emit `tool_call` NormalizedChunks. A new `src/tools/` module owns definitions, execution, and provider format conversion.

**Tech Stack:** Bun, TypeScript, `@google/genai`, `@anthropic-ai/sdk`, Node.js `fs`/`child_process`/`glob`

---

## Minimum Toolset

Seven tools aligned with Claude Code's core set:

| Tool   | Inputs                                          | Purpose                          |
|--------|-------------------------------------------------|----------------------------------|
| `Read` | `path`, optional `offset` + `limit` (lines)    | Read file contents               |
| `Write`| `path`, `content`                               | Create or overwrite a file       |
| `Edit` | `path`, `old_string`, `new_string`              | Exact-match string replacement   |
| `Bash` | `command`, optional `timeout` (ms, default 10s) | Execute shell command            |
| `Glob` | `pattern`, optional `path`                      | Find files by glob pattern       |
| `Grep` | `pattern`, optional `path`, optional `glob`     | Search file contents by regex    |
| `LS`   | `path`                                          | List directory (non-recursive)   |

---

## Architecture

### New module: `src/tools/`

```
src/tools/
├── definitions.ts   — ToolDefinition type + BUILT_IN_TOOLS constant
├── executor.ts      — executeToolCall(name, input, cwd) → Promise<string>
└── converters.ts    — toGeminiTools() + toAnthropicTools()
```

### ToolDefinition type

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; [k: string]: unknown }>;
    required: string[];
  };
}
```

### Agentic loop in server.ts

The `prompt()` handler gains an outer `while` loop. Adapters stay stateless — each `stream()` call is one API round-trip:

```
while (true):
  call adapter.stream(messages, systemPrompt, BUILT_IN_TOOLS, signal)
  toolCallsMade = false
  for each chunk:
    "text"      → stream to Zed via agent_message_chunk, accumulate fullText
    "tool_call" → emit tool label to Zed, execute tool, emit result to Zed,
                  append tool_call + tool_result CanonicalMessages to L1 + JSONL
                  toolCallsMade = true
    "done"      → accumulate token counts, break inner loop
  if !toolCallsMade → break outer loop (final text response, we're done)
```

---

## Message Format

`CanonicalMessage.content` stays `string`. Tool messages use the `metadata` field for structured data.

### tool_call message
```
role:    "tool_call"
content: "Read(src/utils.ts)"          ← human-readable display label
metadata: {
  toolUseId: "toolu_01abc…",           ← provider-assigned ID
  toolName:  "Read",
  toolInput: { path: "src/utils.ts" }  ← parsed input object
}
```

### tool_result message
```
role:    "tool_result"
content: "<file contents or error>"    ← actual result string
metadata: {
  toolUseId: "toolu_01abc…",
  toolName:  "Read",
  isError:   false
}
```

---

## Format Converters (adapters/types.ts)

`toAnthropicMessages()` extended to handle tool roles:

```
tool_call   → { role: "assistant", content: [{ type: "tool_use",    id, name, input }] }
tool_result → { role: "user",      content: [{ type: "tool_result", tool_use_id, content }] }
```

`toGeminiContents()` extended to handle tool roles:

```
tool_call   → { role: "model", parts: [{ functionCall: { name, args } }] }
tool_result → { role: "user",  parts: [{ functionResponse: { name, response: { output } } }] }
```

---

## Adapter Changes

### GeminiAdapter
- Accepts `tools: ToolDefinition[]`, converts via `toGeminiTools()` → `FunctionDeclaration[]`
- Passes as `config.tools` in `generateContentStream()`
- In chunk loop: alongside existing `text` part extraction, detect `functionCall` parts
- Yields `{ type: "tool_call", toolName: part.functionCall.name, toolInput: part.functionCall.args }`
- Yields `{ type: "done", ... }` after stream ends (with or without tool calls)

### ProxyClaudeAdapter
- Accepts `tools: ToolDefinition[]`, converts via `toAnthropicTools()` → `Anthropic.Tool[]`
- Passes as `tools` in `messages.create()`
- Detects `content_block_start` with `type: "tool_use"` → captures `id` and `name`
- Accumulates `input_json_delta` strings into a buffer per block
- On `content_block_stop` → yields `{ type: "tool_call", toolName, toolInput: JSON.parse(buffer) }`

### ClaudeAdapter
Unchanged. Deferred to a future phase.

---

## Display in Zed

Tool calls emitted as formatted `agent_message_chunk` text (no ACP protocol changes needed):

```
**[Read]** `src/context/types.ts`
> 124 lines
```
```
**[Bash]** `bun test`
> 61 pass, 0 fail [78ms]
```
```
**[Read]** `nonexistent.ts`
> Error: ENOENT: no such file or directory
```

---

## Context Layer Impact

Tool call and result messages are added to L1 (`ClientContextStore`) so they appear in subsequent API payloads. The `addMessage()` method on `ContextNode` must accept all `MessageRole` values (currently only `"user" | "assistant"`).

Token counting for tool messages: `content.length / 4` estimate (same as current messages), tracked in session cumulative totals.

---

## JSONL Persistence

Tool call and result messages persisted via `sessionManager.appendMessage()` with their `metadata` field populated. On session load/resume, `toAnthropicMessages()` / `toGeminiContents()` reconstruct the correct provider-native format from stored metadata.

---

## Security

- **Bash**: executes as the current user. No sandboxing — same trust level as the compiled binary itself.
- **File paths**: absolute and relative paths both allowed (same as Claude Code).
- **Write/Edit**: no path restriction. User is responsible for what they ask the model to do.

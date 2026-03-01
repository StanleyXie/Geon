# Tool Calling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 7-tool Claude Code-aligned toolset to GEON with native per-provider tool calling for GeminiAdapter and ProxyClaudeAdapter, driven by a server-side agentic loop.

**Architecture:** New `src/tools/` module owns definitions, execution, and provider format conversion. Server `prompt()` gains a `while` loop; adapters stay stateless. Tool call messages use `ToolCallLine` for JSONL and `tool_call`/`tool_result` `CanonicalMessage` roles in L1. ClaudeAdapter is unchanged.

**Tech Stack:** Bun, TypeScript, `@google/genai`, `@anthropic-ai/sdk`, `glob` (already in deps), Node.js `fs`/`child_process`

---

## Codebase Context

Before starting, read these files:
- `src/tools/` — does not exist yet
- `src/adapters/types.ts` — `NormalizedChunk`, `toAnthropicMessages`, `toGeminiContents`
- `src/adapters/gemini.ts` — current stream loop (text-only)
- `src/adapters/proxy-claude.ts` — current stream loop (text-only)
- `src/acp/server.ts` — `prompt()` handler at line ~238
- `src/context/graph.ts` — `ContextNode.addMessage(role, content)`
- `src/session/types.ts` — `ToolCallLine`, `MessageLine`, `SessionLine`
- `src/__tests__/adapters.test.ts` — existing adapter tests to extend

---

### Task 1: Tool definitions module

**Files:**
- Create: `src/tools/definitions.ts`
- Create: `src/__tests__/tools-definitions.test.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/tools-definitions.test.ts
import { describe, it, expect } from "bun:test";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

describe("BUILT_IN_TOOLS", () => {
  const EXPECTED_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"];

  it("defines exactly 7 tools", () => {
    expect(BUILT_IN_TOOLS).toHaveLength(7);
  });

  it("has all expected tool names", () => {
    const names = BUILT_IN_TOOLS.map(t => t.name);
    for (const n of EXPECTED_NAMES) expect(names).toContain(n);
  });

  it("each tool has name, description, inputSchema", () => {
    for (const t of BUILT_IN_TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.inputSchema.properties).toBe("object");
    }
  });

  it("Read requires path", () => {
    const read = BUILT_IN_TOOLS.find(t => t.name === "Read")!;
    expect(read.inputSchema.required).toContain("path");
  });

  it("Bash requires command", () => {
    const bash = BUILT_IN_TOOLS.find(t => t.name === "Bash")!;
    expect(bash.inputSchema.required).toContain("command");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/tools-definitions.test.ts
```
Expected: FAIL — `Cannot find module '../tools/definitions.js'`

**Step 3: Implement**

```typescript
// src/tools/definitions.ts
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; [k: string]: unknown }>;
    required: string[];
  };
}

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: "Read",
    description: "Read the contents of a file. Returns the file content with line count. Use offset and limit to read a specific range of lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to read" },
        offset: { type: "number", description: "1-based line number to start reading from (optional)" },
        limit: { type: "number", description: "Maximum number of lines to read (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "Write",
    description: "Write content to a file, creating it (and any parent directories) if it does not exist, or overwriting it if it does.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to write" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "Edit",
    description: "Edit a file by replacing the first exact occurrence of old_string with new_string. Fails if old_string is not found.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to edit" },
        old_string: { type: "string", description: "Exact string to find and replace" },
        new_string: { type: "string", description: "String to replace it with" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "Bash",
    description: "Execute a shell command and return its stdout and stderr. Commands run in the current working directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 10000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns sorted list of matching paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.json'" },
        path: { type: "string", description: "Base directory to search in (default: cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Search file contents for a regular expression pattern. Returns matching lines with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "Directory or file to search (default: cwd)" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts'). Default: '**/*'" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "LS",
    description: "List the contents of a directory (non-recursive). Directories are shown with a trailing /.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
      required: ["path"],
    },
  },
];
```

**Step 4: Run test to verify it passes**

```bash
bun test src/__tests__/tools-definitions.test.ts
```
Expected: 5 pass, 0 fail

**Step 5: Commit**

```bash
git add src/tools/definitions.ts src/__tests__/tools-definitions.test.ts
git commit -m "feat: add tool definitions module with 7 built-in tools"
```

---

### Task 2: Tool executor

**Files:**
- Create: `src/tools/executor.ts`
- Create: `src/__tests__/tools-executor.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/tools-executor.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { executeToolCall } from "../tools/executor.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

function fresh() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "geon-tools-test-"));
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Read", () => {
  it("reads a file", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "line1\nline2\nline3");
    const result = await executeToolCall("Read", { path: path.join(tmpDir, "a.txt") }, tmpDir);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  it("respects offset and limit", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "l1\nl2\nl3\nl4\nl5");
    const result = await executeToolCall("Read", { path: path.join(tmpDir, "a.txt"), offset: 2, limit: 2 }, tmpDir);
    expect(result).toContain("l2");
    expect(result).toContain("l3");
    expect(result).not.toContain("l4");
  });

  it("throws on missing file", async () => {
    fresh();
    await expect(executeToolCall("Read", { path: path.join(tmpDir, "missing.txt") }, tmpDir)).rejects.toThrow();
  });
});

describe("Write", () => {
  it("creates a file with content", async () => {
    fresh();
    const filePath = path.join(tmpDir, "new.txt");
    const result = await executeToolCall("Write", { path: filePath, content: "hello" }, tmpDir);
    expect(result).toContain("Written");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello");
  });

  it("creates parent directories", async () => {
    fresh();
    const filePath = path.join(tmpDir, "a", "b", "c.txt");
    await executeToolCall("Write", { path: filePath, content: "x" }, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("Edit", () => {
  it("replaces first occurrence of old_string", async () => {
    fresh();
    const filePath = path.join(tmpDir, "e.txt");
    fs.writeFileSync(filePath, "foo bar foo");
    await executeToolCall("Edit", { path: filePath, old_string: "foo", new_string: "baz" }, tmpDir);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("baz bar foo");
  });

  it("throws if old_string not found", async () => {
    fresh();
    const filePath = path.join(tmpDir, "e.txt");
    fs.writeFileSync(filePath, "hello");
    await expect(executeToolCall("Edit", { path: filePath, old_string: "nope", new_string: "x" }, tmpDir)).rejects.toThrow("not found");
  });
});

describe("Bash", () => {
  it("returns command output", async () => {
    fresh();
    const result = await executeToolCall("Bash", { command: "echo hello" }, tmpDir);
    expect(result).toContain("hello");
  });

  it("returns error output gracefully", async () => {
    fresh();
    const result = await executeToolCall("Bash", { command: "ls /nonexistent-path-xyz" }, tmpDir);
    expect(result.toLowerCase()).toMatch(/error|no such|not found/);
  });
});

describe("Glob", () => {
  it("finds matching files", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "c.js"), "");
    const result = await executeToolCall("Glob", { pattern: "*.ts", path: tmpDir }, tmpDir);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).not.toContain("c.js");
  });

  it("returns no matches message when none found", async () => {
    fresh();
    const result = await executeToolCall("Glob", { pattern: "*.xyz", path: tmpDir }, tmpDir);
    expect(result).toBe("(no matches)");
  });
});

describe("Grep", () => {
  it("finds matching lines with file:line format", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "x.ts"), "const foo = 1;\nconst bar = 2;\n");
    const result = await executeToolCall("Grep", { pattern: "foo", path: tmpDir, glob: "*.ts" }, tmpDir);
    expect(result).toContain("x.ts:1");
    expect(result).toContain("foo");
  });

  it("returns no matches when pattern not found", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "x.ts"), "hello world");
    const result = await executeToolCall("Grep", { pattern: "xyz123", path: tmpDir }, tmpDir);
    expect(result).toBe("(no matches)");
  });
});

describe("LS", () => {
  it("lists directory contents with trailing slash for dirs", async () => {
    fresh();
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "");
    fs.mkdirSync(path.join(tmpDir, "subdir"));
    const result = await executeToolCall("LS", { path: tmpDir }, tmpDir);
    expect(result).toContain("file.txt");
    expect(result).toContain("subdir/");
  });
});

describe("unknown tool", () => {
  it("throws on unknown tool name", async () => {
    fresh();
    await expect(executeToolCall("Unknown", {}, tmpDir)).rejects.toThrow("Unknown tool");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/tools-executor.test.ts
```
Expected: FAIL — `Cannot find module '../tools/executor.js'`

**Step 3: Implement**

```typescript
// src/tools/executor.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";

const execFileAsync = promisify(execFile);

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  switch (name) {
    case "Read":  return execRead(input, cwd);
    case "Write": return execWrite(input, cwd);
    case "Edit":  return execEdit(input, cwd);
    case "Bash":  return execBash(input, cwd);
    case "Glob":  return execGlob(input, cwd);
    case "Grep":  return execGrep(input, cwd);
    case "LS":    return execLs(input, cwd);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function resolvePath(p: unknown, cwd: string): string {
  const s = String(p ?? "");
  return path.isAbsolute(s) ? s : path.resolve(cwd, s);
}

async function execRead(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  const content = await fs.promises.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const offset = typeof input["offset"] === "number" ? input["offset"] - 1 : 0;
  const limit = typeof input["limit"] === "number" ? input["limit"] : lines.length;
  const sliced = lines.slice(offset, offset + limit);
  return sliced.join("\n") + `\n\n(${sliced.length} lines)`;
}

async function execWrite(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, String(input["content"] ?? ""), "utf-8");
  return `Written: ${filePath}`;
}

async function execEdit(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  const oldStr = String(input["old_string"] ?? "");
  const newStr = String(input["new_string"] ?? "");
  const content = await fs.promises.readFile(filePath, "utf-8");
  if (!content.includes(oldStr)) {
    throw new Error(`old_string not found in ${path.relative(cwd, filePath)}`);
  }
  await fs.promises.writeFile(filePath, content.replace(oldStr, newStr), "utf-8");
  return `Edited: ${path.relative(cwd, filePath)}`;
}

async function execBash(input: Record<string, unknown>, cwd: string): Promise<string> {
  const command = String(input["command"] ?? "");
  const timeout = typeof input["timeout"] === "number" ? input["timeout"] : 10000;
  const shell = process.env["SHELL"] ?? "/bin/sh";
  try {
    const { stdout, stderr } = await execFileAsync(shell, ["-c", command], {
      cwd, timeout, encoding: "utf8",
    });
    return (stdout + (stderr ? `\nstderr: ${stderr}` : "")).trim() || "(no output)";
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `Error: ${(e.stderr ?? e.message ?? String(err)).trim()}`;
  }
}

async function execGlob(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = String(input["pattern"] ?? "");
  const basePath = input["path"] ? resolvePath(input["path"], cwd) : cwd;
  const matches = await glob(pattern, { cwd: basePath });
  if (matches.length === 0) return "(no matches)";
  return matches.sort().join("\n") + `\n\n(${matches.length} files)`;
}

async function execGrep(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = String(input["pattern"] ?? "");
  const searchPath = input["path"] ? resolvePath(input["path"], cwd) : cwd;
  const globPattern = input["glob"] ? String(input["glob"]) : "**/*";
  const regex = new RegExp(pattern);
  const files = await glob(globPattern, { cwd: searchPath, nodir: true, absolute: true });
  const results: string[] = [];
  for (const file of files.sort()) {
    try {
      const content = await fs.promises.readFile(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(cwd, file);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) results.push(`${relPath}:${i + 1}: ${lines[i]}`);
      }
    } catch { /* skip unreadable */ }
  }
  if (results.length === 0) return "(no matches)";
  return results.join("\n") + `\n\n(${results.length} matches)`;
}

async function execLs(input: Record<string, unknown>, cwd: string): Promise<string> {
  const dirPath = resolvePath(input["path"] ?? ".", cwd);
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  if (entries.length === 0) return "(empty directory)";
  return entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => e.name + (e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : ""))
    .join("\n") + `\n\n(${entries.length} entries)`;
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/__tests__/tools-executor.test.ts
```
Expected: ~16 pass, 0 fail

**Step 5: Commit**

```bash
git add src/tools/executor.ts src/__tests__/tools-executor.test.ts
git commit -m "feat: add tool executor for all 7 built-in tools"
```

---

### Task 3: Provider format converters

**Files:**
- Create: `src/tools/converters.ts`
- Create: `src/__tests__/tools-converters.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/tools-converters.test.ts
import { describe, it, expect } from "bun:test";
import { toAnthropicTools, toGeminiTools } from "../tools/converters.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

describe("toAnthropicTools", () => {
  it("converts all 7 tools", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    expect(result).toHaveLength(7);
  });

  it("produces name, description, input_schema fields", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    for (const t of result) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("Read tool has input_schema.properties.path", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    const read = result.find(t => t.name === "Read")!;
    expect(read.input_schema.properties).toHaveProperty("path");
  });
});

describe("toGeminiTools", () => {
  it("converts all 7 tools", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    expect(result).toHaveLength(7);
  });

  it("produces name, description, parameters fields", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    for (const t of result) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.parameters.type).toBe("object");
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/tools-converters.test.ts
```
Expected: FAIL — `Cannot find module '../tools/converters.js'`

**Step 3: Implement**

```typescript
// src/tools/converters.ts
import type { ToolDefinition } from "./definitions.js";
import type Anthropic from "@anthropic-ai/sdk";

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export function toGeminiTools(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/__tests__/tools-converters.test.ts
```
Expected: all pass

**Step 5: Commit**

```bash
git add src/tools/converters.ts src/__tests__/tools-converters.test.ts
git commit -m "feat: add provider format converters for tools"
```

---

### Task 4: Extend format converters for tool_call/tool_result messages

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/__tests__/adapters.test.ts`

**Step 1: Add failing tests to `src/__tests__/adapters.test.ts`**

Add these test cases after the existing `toAnthropicMessages` and `toGeminiContents` tests:

```typescript
// Add to describe("toAnthropicMessages"):

  it("converts tool_call to assistant message with tool_use block", () => {
    const msgs = [msg("tool_call", "Read(src/utils.ts)")];
    msgs[0]!.metadata = { toolUseId: "id-1", toolName: "Read", toolInput: { path: "src/utils.ts" } };
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("assistant");
    const content = result[0]!.content as Array<{ type: string; id?: string; name?: string }>;
    expect(content[0]!.type).toBe("tool_use");
    expect(content[0]!.id).toBe("id-1");
    expect(content[0]!.name).toBe("Read");
  });

  it("converts tool_result to user message with tool_result block", () => {
    const msgs = [msg("tool_result", "file contents here")];
    msgs[0]!.metadata = { toolUseId: "id-1", toolName: "Read", isError: false };
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    const content = result[0]!.content as Array<{ type: string; tool_use_id?: string; content?: string }>;
    expect(content[0]!.type).toBe("tool_result");
    expect(content[0]!.tool_use_id).toBe("id-1");
    expect(content[0]!.content).toBe("file contents here");
  });

// Add to describe("toGeminiContents"):

  it("converts tool_call to model message with functionCall part", () => {
    const msgs = [msg("tool_call", "Read(src/utils.ts)")];
    msgs[0]!.metadata = { toolName: "Read", toolInput: { path: "src/utils.ts" } };
    const result = toGeminiContents(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("model");
    expect(result[0]!.parts[0]).toHaveProperty("functionCall");
    const fc = result[0]!.parts[0]!.functionCall as { name: string; args: unknown };
    expect(fc.name).toBe("Read");
  });

  it("converts tool_result to user message with functionResponse part", () => {
    const msgs = [msg("tool_result", "file contents")];
    msgs[0]!.metadata = { toolName: "Read" };
    const result = toGeminiContents(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.parts[0]).toHaveProperty("functionResponse");
  });
```

**Step 2: Run tests to verify they fail**

```bash
bun test src/__tests__/adapters.test.ts
```
Expected: new tests fail (existing tests still pass)

**Step 3: Update `toAnthropicMessages` and `toGeminiContents` in `src/adapters/types.ts`**

Also add `toolUseId?: string` to `NormalizedChunk`.

Replace the existing `toAnthropicMessages` and `toGeminiContents` functions:

```typescript
// Replace AnthropicMessage interface and toAnthropicMessages with:

import type Anthropic from "@anthropic-ai/sdk";

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
```

Also add `toolUseId?: string` to `NormalizedChunk`:

```typescript
export interface NormalizedChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;      // ← add this line
  toolResult?: unknown;
  isError?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheHitTokens?: number;
}
```

Also update `toGeminiContents`:

```typescript
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
```

Note: the old `AnthropicMessage` interface is no longer needed since `toAnthropicMessages` now returns `Anthropic.MessageParam[]`. Remove it and remove any import of it from other files.

Also: `proxy-claude.ts` builds `anthropicMessages` inline with a filter/map — change it to use `toAnthropicMessages(messages)` instead. The inline code at lines 55-57 should be replaced:

```typescript
// Remove these lines from proxy-claude.ts:
// const anthropicMessages: Anthropic.MessageParam[] = messages
//   .filter(m => m.role === "user" || m.role === "assistant")
//   .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

// Replace with:
import { toAnthropicMessages } from "./types.js";
const anthropicMessages = toAnthropicMessages(messages);
```

**Step 4: Run all tests**

```bash
bun test
```
Expected: all pass (61 + new tests)

**Step 5: Commit**

```bash
git add src/adapters/types.ts src/__tests__/adapters.test.ts src/adapters/proxy-claude.ts
git commit -m "feat: extend message converters to handle tool_call/tool_result roles"
```

---

### Task 5: Thread metadata through ContextNode.addMessage

**Files:**
- Modify: `src/context/graph.ts` (2 lines)

**Step 1: Write the failing test** — add to `src/__tests__/graph.test.ts`:

```typescript
// Add inside existing describe("ContextNode"):
  it("addMessage passes metadata to the store", () => {
    const graph = ContextGraph.create("gemini-2.5-flash");
    const node = graph.activeNode;
    const meta = { toolUseId: "abc", toolName: "Read" };
    const msg = node.addMessage("tool_call", "Read(file.ts)", meta);
    expect(msg.metadata).toEqual(meta);
  });
```

**Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/graph.test.ts
```
Expected: new test fails — `addMessage` doesn't accept 3 args

**Step 3: Update `ContextNode.addMessage` in `src/context/graph.ts`**

```typescript
// Change:
addMessage(role: CanonicalMessage["role"], content: string): CanonicalMessage {
  return this.store.addMessage(role, content);
}

// To:
addMessage(role: CanonicalMessage["role"], content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
  return this.store.addMessage(role, content, metadata);
}
```

**Step 4: Run all tests**

```bash
bun test
```
Expected: all pass

**Step 5: Commit**

```bash
git add src/context/graph.ts src/__tests__/graph.test.ts
git commit -m "feat: thread metadata through ContextNode.addMessage"
```

---

### Task 6: Update GeminiAdapter to yield tool_call chunks

**Files:**
- Modify: `src/adapters/gemini.ts`

**Step 1: Write the failing test** — add to a new `src/__tests__/adapters-gemini.test.ts`:

```typescript
// src/__tests__/adapters-gemini.test.ts
import { describe, it, expect } from "bun:test";
import { toGeminiContents } from "../adapters/types.js";
import type { CanonicalMessage } from "../context/types.js";

// Unit-test the Gemini content builder with tool messages (no live API needed)
function msg(role: CanonicalMessage["role"], content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
  return { role, content, timestamp: 0, tokenCount: 1, byteSize: content.length, contentHash: "x", metadata };
}

describe("toGeminiContents with tool messages", () => {
  it("round-trips a tool call sequence", () => {
    const msgs = [
      msg("user", "read file"),
      msg("tool_call", "Read(src/a.ts)", { toolName: "Read", toolInput: { path: "src/a.ts" } }),
      msg("tool_result", "content here", { toolName: "Read" }),
      msg("assistant", "Here is the content."),
    ];
    const contents = toGeminiContents(msgs);
    expect(contents).toHaveLength(4);
    expect(contents[0]!.role).toBe("user");
    expect(contents[1]!.role).toBe("model");
    expect(contents[1]!.parts[0]).toHaveProperty("functionCall");
    expect(contents[2]!.role).toBe("user");
    expect(contents[2]!.parts[0]).toHaveProperty("functionResponse");
    expect(contents[3]!.role).toBe("model");
    expect(contents[3]!.parts[0]).toHaveProperty("text");
  });
});
```

**Step 2: Run test to verify it passes** (this tests the converter from Task 4 — should already pass)

```bash
bun test src/__tests__/adapters-gemini.test.ts
```
Expected: pass (verifies Task 4 is correct before modifying GeminiAdapter)

**Step 3: Update `src/adapters/gemini.ts`**

Add imports at the top:
```typescript
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
import { toGeminiTools } from "../tools/converters.js";
```

Change the `_tools` parameter to `tools`:
```typescript
async *stream(
  messages: CanonicalMessage[],
  systemPrompt: string,
  tools: unknown[],       // ← was _tools
  signal: AbortSignal,
): AsyncIterable<NormalizedChunk> {
```

Convert tools and pass to the API call. Replace the `config` block inside `generateContentStream`:
```typescript
const geminiTools = toGeminiTools(BUILT_IN_TOOLS);

const stream = await client.models.generateContentStream({
  model: this.modelId,
  contents,
  config: {
    ...(sysInstruction ? { systemInstruction: sysInstruction } : {}),
    tools: [{ functionDeclarations: geminiTools }],
    abortSignal: signal,
  },
});
```

Replace the text extraction inside `for await (const chunk of stream)`:
```typescript
for await (const chunk of stream) {
  if (signal.aborted) break;

  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if ("text" in p && p.text) {
      yield { type: "text", text: p.text };
    } else if ("functionCall" in p && p.functionCall) {
      const fc = p.functionCall as { name?: string; args?: unknown };
      yield {
        type: "tool_call",
        toolName: fc.name ?? "",
        toolInput: fc.args ?? {},
      };
    }
  }

  const u = chunk.usageMetadata;
  if (u) {
    inputTokens = u.promptTokenCount ?? inputTokens;
    outputTokens = u.candidatesTokenCount ?? outputTokens;
    cacheHitTokens = u.cachedContentTokenCount ?? cacheHitTokens;
  }
}
```

**Step 4: Run all tests**

```bash
bun test
```
Expected: all pass (GeminiAdapter has no live-API unit tests, so no new failures)

**Step 5: Typecheck**

```bash
bun run typecheck
```
Expected: no errors

**Step 6: Commit**

```bash
git add src/adapters/gemini.ts src/__tests__/adapters-gemini.test.ts
git commit -m "feat: GeminiAdapter detects functionCall parts and yields tool_call chunks"
```

---

### Task 7: Update ProxyClaudeAdapter to yield tool_call chunks

**Files:**
- Modify: `src/adapters/proxy-claude.ts`

**Step 1: Write the failing test** — add to `src/__tests__/adapters-proxy-claude.test.ts`:

```typescript
// src/__tests__/adapters-proxy-claude.test.ts
import { describe, it, expect } from "bun:test";
import { toAnthropicMessages } from "../adapters/types.js";
import type { CanonicalMessage } from "../context/types.js";

function msg(role: CanonicalMessage["role"], content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
  return { role, content, timestamp: 0, tokenCount: 1, byteSize: content.length, contentHash: "x", metadata };
}

// Unit-test the Anthropic message builder with tool messages (no live API needed)
describe("toAnthropicMessages with tool messages", () => {
  it("round-trips a tool call sequence", () => {
    const msgs = [
      msg("user", "read file"),
      msg("tool_call", "Read(src/a.ts)", { toolUseId: "tu-1", toolName: "Read", toolInput: { path: "src/a.ts" } }),
      msg("tool_result", "content here", { toolUseId: "tu-1", toolName: "Read", isError: false }),
      msg("assistant", "Here is the content."),
    ];
    const params = toAnthropicMessages(msgs);
    expect(params).toHaveLength(4);
    expect(params[0]!.role).toBe("user");
    expect(params[1]!.role).toBe("assistant");
    const assistantContent = params[1]!.content as Array<{ type: string; id?: string }>;
    expect(assistantContent[0]!.type).toBe("tool_use");
    expect(assistantContent[0]!.id).toBe("tu-1");
    expect(params[2]!.role).toBe("user");
    const userContent = params[2]!.content as Array<{ type: string; tool_use_id?: string }>;
    expect(userContent[0]!.type).toBe("tool_result");
    expect(userContent[0]!.tool_use_id).toBe("tu-1");
    expect(params[3]!.role).toBe("assistant");
  });
});
```

**Step 2: Run test to verify it passes** (tests the converter from Task 4)

```bash
bun test src/__tests__/adapters-proxy-claude.test.ts
```
Expected: pass

**Step 3: Update `src/adapters/proxy-claude.ts`**

Add imports:
```typescript
import { toAnthropicMessages } from "./types.js";
import { toAnthropicTools } from "../tools/converters.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
```

Change the `_tools` parameter to `tools`:
```typescript
async *stream(
  messages: CanonicalMessage[],
  systemPrompt: string,
  tools: unknown[],       // ← was _tools
  signal: AbortSignal,
): AsyncIterable<NormalizedChunk> {
```

Replace the inline message-building block and `messages.create()` call:
```typescript
const sysPrompt = systemPrompt || extractSystemPrompt(messages) || undefined;
const anthropicMessages = toAnthropicMessages(messages);  // ← replaces inline filter/map
const anthropicTools = toAnthropicTools(BUILT_IN_TOOLS);

// State for accumulating tool_use blocks
let currentToolId = "";
let currentToolName = "";
let currentToolInputBuffer = "";
let isInToolUseBlock = false;

try {
  const stream = await client.messages.create({
    model: this.modelId,
    max_tokens: 32768,
    ...(sysPrompt ? { system: sysPrompt } : {}),
    messages: anthropicMessages,
    tools: anthropicTools,
    stream: true,
  });
```

Replace the existing `for await (const event of stream)` body:
```typescript
  for await (const event of stream) {
    if (signal.aborted) break;

    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        isInToolUseBlock = true;
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolInputBuffer = "";
      } else {
        isInToolUseBlock = false;
      }
    } else if (event.type === "content_block_delta") {
      if (isInToolUseBlock && event.delta.type === "input_json_delta") {
        currentToolInputBuffer += event.delta.partial_json;
      } else if (!isInToolUseBlock && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    } else if (event.type === "content_block_stop" && isInToolUseBlock) {
      let toolInput: unknown = {};
      try { toolInput = JSON.parse(currentToolInputBuffer); } catch { /* empty input */ }
      yield {
        type: "tool_call",
        toolName: currentToolName,
        toolInput,
        toolUseId: currentToolId,
      };
      isInToolUseBlock = false;
    } else if (event.type === "message_delta" && event.usage) {
      outputTokens = event.usage.output_tokens;
    } else if (event.type === "message_start" && event.message.usage) {
      const u = event.message.usage as unknown as Record<string, unknown>;
      inputTokens = u["input_tokens"] as number ?? 0;
      cacheHitTokens = u["cache_read_input_tokens"] as number ?? 0;
    }
  }
```

**Step 4: Run all tests and typecheck**

```bash
bun test && bun run typecheck
```
Expected: all pass, no type errors

**Step 5: Commit**

```bash
git add src/adapters/proxy-claude.ts src/__tests__/adapters-proxy-claude.test.ts
git commit -m "feat: ProxyClaudeAdapter detects tool_use blocks and yields tool_call chunks"
```

---

### Task 8: Server-side agentic loop

**Files:**
- Modify: `src/acp/server.ts`

**Step 1: Add imports at the top of `server.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
import { executeToolCall } from "../tools/executor.js";
```

(Check if `randomUUID` is already imported — if so, skip it.)

**Step 2: Add `formatToolLabel` helper** (after the existing helpers, before the class):

```typescript
function formatToolLabel(toolName: string, toolInput: unknown): string {
  const input = toolInput as Record<string, unknown> | undefined;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":  return String(input?.["path"] ?? "");
    case "Bash":  return String(input?.["command"] ?? "");
    case "Glob":  return String(input?.["pattern"] ?? "");
    case "Grep":  return String(input?.["pattern"] ?? "");
    case "LS":    return String(input?.["path"] ?? "");
    default:      return JSON.stringify(toolInput ?? {});
  }
}
```

**Step 3: Replace the `prompt()` body from the stream loop onward**

Find the existing stream section in `prompt()` (around line 264 — starts with `// Prepare payload via StrategyEngine`). Replace everything from that comment down to (and including) the closing `return { stopReason: "end_turn", ... }`, with this new implementation:

```typescript
    // Agentic loop: repeat until the model gives a response with no tool calls
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;
    let assistantText = "";   // final round's text only (for L1 + JSONL)

    try {
      while (!signal.aborted) {
        const payload = node.engine.prepare();
        const adapter = makeAdapter(node.store.modelId);
        let toolCallsMadeThisRound = false;
        let roundText = "";   // text emitted by the model in this round

        for await (const chunk of transformStream(
          adapter.stream(payload.messages, "", BUILT_IN_TOOLS, signal),
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
            const label = `\n\n**[${chunk.toolName}]** \`${formatToolLabel(chunk.toolName, chunk.toolInput)}\`\n`;
            fullText += label;
            await this.conn.sessionUpdate({
              sessionId: req.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: label },
              },
            });

            // Execute the tool
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

            // Emit truncated result preview
            const preview = resultText.split("\n").slice(0, 5).map(l => `> ${l}`).join("\n") + "\n";
            fullText += preview;
            await this.conn.sessionUpdate({
              sessionId: req.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: preview },
              },
            });

            // Add preamble text (model text before tool call) as assistant message
            if (roundText) {
              node.addMessage("assistant", roundText);
              await state.sessionManager.appendMessage(req.sessionId, {
                role: "model",
                content: roundText,
                parts: [{ text: roundText }],
              });
              roundText = "";
            }

            // Add tool_call + tool_result to L1 and JSONL
            const toolLabel = `${chunk.toolName}(${formatToolLabel(chunk.toolName, chunk.toolInput)})`;
            node.addMessage("tool_call", toolLabel, {
              toolUseId,
              toolName: chunk.toolName,
              toolInput: chunk.toolInput,
            });
            node.addMessage("tool_result", resultText, {
              toolUseId,
              toolName: chunk.toolName,
              isError,
            });

            const toolCallLine: import("../session/types.js").ToolCallLine = {
              type: "tool_call",
              toolName: chunk.toolName,
              input: chunk.toolInput,
              result: resultText,
              isError,
              uuid: toolUseId,
              timestamp: Date.now(),
            };
            await state.sessionManager.appendLine(req.sessionId, toolCallLine);

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
      throw err;
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

    // Persist per-turn usage
    const usageLine: UsageLine = {
      type: "usage",
      inputTokens,
      outputTokens,
      cacheHitTokens,
      timestamp: Date.now(),
    };
    await state.sessionManager.appendUsageLine(req.sessionId, usageLine);

    // Usage update to Zed
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

    // Token stats (use fullText for code-block detection since it includes tool labels)
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
```

**Step 4: Update `loadSession` and `unstable_resumeSession` to replay ToolCallLines into L1**

In both `loadSession` and `unstable_resumeSession`, the loop that replays lines into the graph currently only handles `message` lines. Add handling for `tool_call` lines:

```typescript
// In the replay loop (both loadSession and resumeSession):
for (const line of lines) {
  if (line.type === "message") {
    const ml = line as MessageLine;
    const role: "user" | "assistant" =
      ml.role === "model" ? "assistant" : "user";
    node.addMessage(role, ml.content);
  } else if (line.type === "tool_call") {
    const tl = line as import("../session/types.js").ToolCallLine;
    node.addMessage("tool_call", `${tl.toolName}(${JSON.stringify(tl.input)})`, {
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
```

**Step 5: Run all tests and typecheck**

```bash
bun test && bun run typecheck
```
Expected: all pass, no type errors

**Step 6: Commit**

```bash
git add src/acp/server.ts
git commit -m "feat: server-side agentic loop with tool execution for all 7 built-in tools"
```

---

### Task 9: Build and smoke test

**Step 1: Run full test suite**

```bash
bun test
```
Expected: all tests pass (at minimum the 61 existing + new tests from Tasks 1–3)

**Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: no errors

**Step 3: Build binary**

```bash
bun run build
```
Expected: `dist/geon` compiled successfully

**Step 4: Smoke test with Gemini**

Start a new Zed session with GEON using the `gemini-2.5-flash` model. Ask:

```
Read the file src/tools/definitions.ts and tell me how many tools are defined
```

Expected: GEON shows `**[Read]** src/tools/definitions.ts` in the response with a preview, then answers "7 tools".

**Step 5: Smoke test with ProxyClaudeAdapter** (if Antigravity proxy is running)

Same prompt with `Google-Claude Sonnet 4.6` model. Expected: same behavior with Anthropic's native tool_use format.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: rebuild binary with tool calling support"
```

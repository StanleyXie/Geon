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

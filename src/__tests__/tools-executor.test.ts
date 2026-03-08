// src/__tests__/tools-executor.test.ts
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
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

  it("throws when path is missing", async () => {
    fresh();
    await expect(executeToolCall("LS", {}, tmpDir)).rejects.toThrow("requires path");
  });
});

describe("unknown tool", () => {
  it("throws on unknown tool name", async () => {
    fresh();
    await expect(executeToolCall("Unknown", {}, tmpDir)).rejects.toThrow("Unknown tool");
  });
});

// ---------------------------------------------------------------------------
// WebFetch
// ---------------------------------------------------------------------------

function makeFetchResponse(body: string, contentType = "text/plain", ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    headers: { get: (_: string) => contentType },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

describe("WebFetch", () => {
  let origFetch: typeof globalThis.fetch;
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns plain text body unchanged", async () => {
    globalThis.fetch = () => makeFetchResponse("hello world");
    const result = await executeToolCall("WebFetch", { url: "https://example.com" }, "/tmp");
    expect(result).toBe("hello world");
  });

  it("strips HTML tags from HTML response", async () => {
    const html = "<html><body><h1>Title</h1><p>Content here</p></body></html>";
    globalThis.fetch = () => makeFetchResponse(html, "text/html");
    const result = await executeToolCall("WebFetch", { url: "https://example.com" }, "/tmp");
    expect(result).toContain("Title");
    expect(result).toContain("Content here");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("<p>");
  });

  it("strips script and style blocks from HTML", async () => {
    const html = "<html><head><style>body{color:red}</style><script>alert(1)</script></head><body>Real content</body></html>";
    globalThis.fetch = () => makeFetchResponse(html, "text/html");
    const result = await executeToolCall("WebFetch", { url: "https://example.com" }, "/tmp");
    expect(result).toContain("Real content");
    expect(result).not.toContain("color:red");
    expect(result).not.toContain("alert");
  });

  it("throws on HTTP error status", async () => {
    globalThis.fetch = () => makeFetchResponse("", "text/plain", false, 404);
    await expect(
      executeToolCall("WebFetch", { url: "https://example.com/missing" }, "/tmp"),
    ).rejects.toThrow("HTTP 404");
  });

  it("throws when url is missing", async () => {
    await expect(executeToolCall("WebFetch", {}, "/tmp")).rejects.toThrow("requires url");
  });
});

// ---------------------------------------------------------------------------
// WebSearch
// ---------------------------------------------------------------------------

function makeSearchResponse(results: Array<{ title: string; url: string; description?: string }>) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ web: { results } }),
  } as unknown as Response);
}

describe("WebSearch", () => {
  let origFetch: typeof globalThis.fetch;
  let origEnv: string | undefined;
  beforeEach(() => {
    origFetch = globalThis.fetch;
    origEnv = process.env["BRAVE_SEARCH_API_KEY"];
    process.env["BRAVE_SEARCH_API_KEY"] = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origEnv === undefined) delete process.env["BRAVE_SEARCH_API_KEY"];
    else process.env["BRAVE_SEARCH_API_KEY"] = origEnv;
  });

  it("returns formatted results", async () => {
    globalThis.fetch = () => makeSearchResponse([
      { title: "Bun Docs", url: "https://bun.sh/docs", description: "Official Bun documentation" },
      { title: "Bun GitHub", url: "https://github.com/oven-sh/bun", description: "Source code" },
    ]);
    const result = await executeToolCall("WebSearch", { query: "bun runtime" }, "/tmp");
    expect(result).toContain("1. Bun Docs");
    expect(result).toContain("https://bun.sh/docs");
    expect(result).toContain("Official Bun documentation");
    expect(result).toContain("2. Bun GitHub");
    expect(result).toContain("(2 results)");
  });

  it("filters by allowed_domains", async () => {
    globalThis.fetch = () => makeSearchResponse([
      { title: "A", url: "https://allowed.com/page", description: "" },
      { title: "B", url: "https://other.com/page", description: "" },
    ]);
    const result = await executeToolCall("WebSearch", {
      query: "test",
      allowed_domains: ["allowed.com"],
    }, "/tmp");
    expect(result).toContain("allowed.com");
    expect(result).not.toContain("other.com");
  });

  it("filters by blocked_domains", async () => {
    globalThis.fetch = () => makeSearchResponse([
      { title: "A", url: "https://good.com/page", description: "" },
      { title: "B", url: "https://spam.com/page", description: "" },
    ]);
    const result = await executeToolCall("WebSearch", {
      query: "test",
      blocked_domains: ["spam.com"],
    }, "/tmp");
    expect(result).toContain("good.com");
    expect(result).not.toContain("spam.com");
  });

  it("returns no results message when all filtered", async () => {
    globalThis.fetch = () => makeSearchResponse([
      { title: "A", url: "https://blocked.com/page", description: "" },
    ]);
    const result = await executeToolCall("WebSearch", {
      query: "test",
      blocked_domains: ["blocked.com"],
    }, "/tmp");
    expect(result).toContain("No results found.");
  });

  it("returns error message when no provider is configured", async () => {
    delete process.env["BRAVE_SEARCH_API_KEY"];
    delete process.env["GOOGLE_CSE_API_KEY"];
    delete process.env["SERPER_API_KEY"];
    delete process.env["SEARXNG_URL"];
    const result = await executeToolCall("WebSearch", { query: "test" }, "/tmp");
    expect(result).toContain("No search provider configured");
  });

  it("throws when query is missing", async () => {
    await expect(executeToolCall("WebSearch", {}, "/tmp")).rejects.toThrow("requires query");
  });
});

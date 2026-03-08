import { describe, it, expect } from "bun:test";
import { toolCallTitle, toolCallKind, toolCallLocations } from "../acp/server.js";

describe("toolCallTitle", () => {
  it("prefixes Read with path", () => {
    expect(toolCallTitle("Read", { path: "src/foo.ts" })).toBe("Read src/foo.ts");
  });

  it("prefixes Write with path", () => {
    expect(toolCallTitle("Write", { path: "out/bar.ts" })).toBe("Write out/bar.ts");
  });

  it("prefixes Edit with path", () => {
    expect(toolCallTitle("Edit", { path: "src/file.ts" })).toBe("Edit src/file.ts");
  });

  it("returns command for Bash", () => {
    expect(toolCallTitle("Bash", { command: "ls -la" })).toBe("ls -la");
  });

  it("returns find with path and pattern for Glob", () => {
    expect(toolCallTitle("Glob", { path: "src/", pattern: "**/*.ts" })).toBe("find `src/` `**/*.ts`");
  });

  it("returns find with pattern only for Glob", () => {
    expect(toolCallTitle("Glob", { pattern: "**/*.ts" })).toBe("find `.` `**/*.ts`");
  });

  it("returns grep with quoted pattern for Grep", () => {
    expect(toolCallTitle("Grep", { pattern: "TODO" })).toBe("grep `TODO` `.`");
  });

  it("prefixes LS with path", () => {
    expect(toolCallTitle("LS", { path: "src/" })).toBe("ls src/");
  });

  it("returns tool name for unknown tool", () => {
    expect(toolCallTitle("UnknownTool", { x: 1 })).toBe("UnknownTool");
  });

  it("returns base for Read with no path", () => {
    expect(toolCallTitle("Read", {})).toBe("Read undefined");
  });

  it("prefixes WebFetch with Fetch and url", () => {
    expect(toolCallTitle("WebFetch", { url: "https://example.com" })).toBe("Fetch https://example.com");
  });

  it("returns search query for WebSearch", () => {
    expect(toolCallTitle("WebSearch", { query: "bun runtime" })).toBe("Search: bun runtime");
  });
});

describe("toolCallKind", () => {
  it("returns read for Read", () => expect(toolCallKind("Read")).toBe("read"));
  it("returns search for LS", () => expect(toolCallKind("LS")).toBe("search"));
  it("returns edit for Write", () => expect(toolCallKind("Write")).toBe("edit"));
  it("returns edit for Edit", () => expect(toolCallKind("Edit")).toBe("edit"));
  it("returns execute for Bash", () => expect(toolCallKind("Bash")).toBe("execute"));
  it("returns search for Glob", () => expect(toolCallKind("Glob")).toBe("search"));
  it("returns search for Grep", () => expect(toolCallKind("Grep")).toBe("search"));
  it("returns fetch for WebFetch", () => expect(toolCallKind("WebFetch")).toBe("fetch"));
  it("returns fetch for WebSearch", () => expect(toolCallKind("WebSearch")).toBe("fetch"));
  it("returns other for unknown", () => expect(toolCallKind("Mystery")).toBe("other"));
});

describe("toolCallLocations", () => {
  it("returns location for Read with path", () => {
    expect(toolCallLocations("Read", { path: "src/foo.ts" })).toEqual([{ path: "src/foo.ts", line: 1 }]);
  });

  it("returns location for Write with path", () => {
    expect(toolCallLocations("Write", { path: "out/bar.ts" })).toEqual([{ path: "out/bar.ts" }]);
  });

  it("returns location for Edit with path", () => {
    expect(toolCallLocations("Edit", { path: "src/file.ts" })).toEqual([{ path: "src/file.ts" }]);
  });

  it("returns location for LS with path", () => {
    expect(toolCallLocations("LS", { path: "src/" })).toEqual([{ path: "src/" }]);
  });

  it("returns empty for Bash (no file location)", () => {
    expect(toolCallLocations("Bash", { command: "ls" })).toEqual([]);
  });

  it("returns location for Glob (path provided)", () => {
    expect(toolCallLocations("Glob", { path: "src/", pattern: "**/*.ts" })).toEqual([{ path: "src/" }]);
  });

  it("returns empty for Glob (no path)", () => {
    expect(toolCallLocations("Glob", { pattern: "**/*.ts" })).toEqual([]);
  });

  it("returns empty for Read with missing path", () => {
    expect(toolCallLocations("Read", {})).toEqual([{ path: undefined, line: 1 }]);
  });

  it("returns empty for WebFetch (no file location)", () => {
    expect(toolCallLocations("WebFetch", { url: "https://example.com" })).toEqual([]);
  });

  it("returns empty for WebSearch (no file location)", () => {
    expect(toolCallLocations("WebSearch", { query: "test" })).toEqual([]);
  });
});

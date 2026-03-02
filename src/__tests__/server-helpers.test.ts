import { describe, it, expect } from "bun:test";
import { formatToolLabel } from "../acp/server.js";

describe("formatToolLabel", () => {
  it("returns path for Read", () => {
    expect(formatToolLabel("Read", { path: "src/foo.ts" })).toBe("src/foo.ts");
  });

  it("returns path for Write", () => {
    expect(formatToolLabel("Write", { path: "out/bar.ts" })).toBe("out/bar.ts");
  });

  it("returns command for Bash", () => {
    expect(formatToolLabel("Bash", { command: "ls -la" })).toBe("ls -la");
  });

  it("returns pattern for Glob", () => {
    expect(formatToolLabel("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("returns pattern for Grep", () => {
    expect(formatToolLabel("Grep", { pattern: "TODO" })).toBe("TODO");
  });

  it("returns path for LS", () => {
    expect(formatToolLabel("LS", { path: "src/" })).toBe("src/");
  });

  it("returns JSON for unknown tool", () => {
    const result = formatToolLabel("UnknownTool", { x: 1 });
    expect(result).toBe('{"x":1}');
  });

  it("returns empty string for missing path on Read", () => {
    expect(formatToolLabel("Read", {})).toBe("");
  });
});

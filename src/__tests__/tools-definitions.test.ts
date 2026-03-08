import { describe, it, expect } from "bun:test";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

describe("BUILT_IN_TOOLS", () => {
  const EXPECTED_NAMES = [
    "Read", "Write", "Edit", "Bash", "Glob", "Find", "Grep", "LS", "WebFetch", "WebSearch", "GoogleGroundedSearch"
  ];

  it("defines exactly 11 tools", () => {
    expect(BUILT_IN_TOOLS).toHaveLength(11);
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

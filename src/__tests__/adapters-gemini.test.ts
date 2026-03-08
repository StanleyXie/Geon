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
  });

  it("groups text thinking + tool_call into one turn", () => {
    const msgs = [
      msg("user", "do something"),
      msg("assistant", "I will run a command."),
      msg("tool_call", "Bash(ls)", { toolName: "Bash", toolInput: { command: "ls" } }),
    ];
    const contents = toGeminiContents(msgs);
    expect(contents).toHaveLength(2); // 1 user, 1 model (with 2 parts)
    expect(contents[1]!.role).toBe("model");
    expect(contents[1]!.parts).toHaveLength(2);
    expect(contents[1]!.parts[0]).toHaveProperty("text");
    expect(contents[1]!.parts[1]).toHaveProperty("functionCall");
  });
});

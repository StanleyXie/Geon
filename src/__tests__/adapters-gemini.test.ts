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

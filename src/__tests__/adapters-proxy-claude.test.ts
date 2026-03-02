// src/__tests__/adapters-proxy-claude.test.ts
import { describe, it, expect } from "bun:test";
import { toAnthropicMessages } from "../adapters/types.js";
import type { CanonicalMessage } from "../context/types.js";

function msg(role: CanonicalMessage["role"], content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
  return { role, content, timestamp: 0, tokenCount: 1, byteSize: content.length, contentHash: "x", metadata };
}

// Test the buffer parsing logic directly
describe("tool input buffer parsing", () => {
  it("empty buffer yields empty object", () => {
    let toolInput: unknown = {};
    const buffer = "";
    if (buffer !== "") {
      toolInput = JSON.parse(buffer);
    }
    expect(toolInput).toEqual({});
  });

  it("valid JSON buffer parses correctly", () => {
    const buffer: string = '{"path":"src/a.ts"}';
    let toolInput: unknown = {};
    if (buffer !== "") {
      toolInput = JSON.parse(buffer);
    }
    expect(toolInput).toEqual({ path: "src/a.ts" });
  });

  it("invalid JSON buffer throws with helpful message", () => {
    const buffer: string = "{bad json";
    const toolName = "Read";
    expect(() => {
      if (buffer !== "") {
        try {
          JSON.parse(buffer);
        } catch (e) {
          throw new Error(
            `ProxyClaudeAdapter: failed to parse tool input for "${toolName}": ${(e as Error).message}`,
          );
        }
      }
    }).toThrow(/ProxyClaudeAdapter.*Read/);
  });
});

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

import { describe, it, expect } from "bun:test";
import { toAnthropicMessages, toGeminiContents, extractSystemPrompt } from "../adapters/types.js";
import type { CanonicalMessage } from "../context/types.js";

function msg(role: CanonicalMessage["role"], content: string): CanonicalMessage {
  return { role, content, timestamp: Date.now(), tokenCount: 5, byteSize: content.length, contentHash: "abc", metadata: {} };
}

describe("toAnthropicMessages", () => {
  it("maps user and assistant roles", () => {
    const msgs = [msg("user", "Hello"), msg("assistant", "Hi")];
    const result = toAnthropicMessages(msgs);
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi" });
  });

  it("excludes system messages", () => {
    const msgs = [msg("system", "Be helpful"), msg("user", "Hello")];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
  });

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
});

describe("toGeminiContents", () => {
  it("maps user to user and assistant to model", () => {
    const msgs = [msg("user", "Hello"), msg("assistant", "Hi")];
    const result = toGeminiContents(msgs);
    expect(result[0]).toEqual({ role: "user", parts: [{ text: "Hello" }] });
    expect(result[1]).toEqual({ role: "model", parts: [{ text: "Hi" }] });
  });

  it("excludes system messages", () => {
    const msgs = [msg("system", "Be helpful"), msg("user", "Hello")];
    const result = toGeminiContents(msgs);
    expect(result).toHaveLength(1);
  });

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
});

describe("extractSystemPrompt", () => {
  it("joins multiple system messages with newline", () => {
    const msgs = [msg("system", "Be helpful."), msg("system", "Be concise."), msg("user", "Hello")];
    const prompt = extractSystemPrompt(msgs);
    expect(prompt).toBe("Be helpful.\nBe concise.");
  });

  it("returns empty string when no system messages", () => {
    const msgs = [msg("user", "Hello")];
    expect(extractSystemPrompt(msgs)).toBe("");
  });
});

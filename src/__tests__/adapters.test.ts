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

  it("excludes tool_call and tool_result messages", () => {
    const msgs = [msg("user", "Do it"), msg("tool_call", "{}"), msg("tool_result", "done"), msg("assistant", "Done")];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(2);
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

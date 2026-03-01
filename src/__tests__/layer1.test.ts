import { describe, it, expect } from "bun:test";
import { getModelSpec, PRICING } from "../context/model-registry.js";
import { ClientContextStore } from "../context/layer1.js";

describe("model-registry", () => {
  it("has claude-sonnet-4-6", () => {
    const spec = getModelSpec("claude-sonnet-4-6");
    expect(spec.maxContext).toBe(200_000);
    expect(spec.numLayers).toBe(80);
    expect(spec.numKvHeads).toBe(8);
  });

  it("has gemini-2.5-pro", () => {
    const spec = getModelSpec("gemini-2.5-pro");
    expect(spec.maxContext).toBe(1_000_000);
    expect(spec.provider).toBe("google");
  });

  it("throws for unknown model", () => {
    expect(() => getModelSpec("unknown-model-xyz")).toThrow("Unknown model");
  });

  it("has pricing for claude-sonnet-4-6", () => {
    const p = PRICING["claude-sonnet-4-6"];
    expect(p).toBeDefined();
    expect(p!.inputPerMillion).toBe(3.00);
    expect(p!.outputPerMillion).toBe(15.00);
  });
});

describe("ClientContextStore", () => {
  it("starts empty", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    const snap = store.snapshot();
    expect(snap.totalTokens).toBe(0);
    expect(snap.messageCount).toBe(0);
    expect(snap.utilizationPct).toBe(0);
    expect(snap.contextLimit).toBe(200_000);
  });

  it("adds messages and counts tokens", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "Hello world");
    const snap = store.snapshot();
    expect(snap.totalTokens).toBeGreaterThan(0);
    expect(snap.messageCount).toBe(1);
    expect(snap.tokensByRole["user"]).toBeGreaterThan(0);
  });

  it("tracks headroom correctly", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "test");
    const snap = store.snapshot();
    expect(snap.headroomTokens).toBe(snap.contextLimit - snap.totalTokens);
  });

  it("computes stable prefix hash", () => {
    const store1 = new ClientContextStore("claude-sonnet-4-6");
    const store2 = new ClientContextStore("claude-sonnet-4-6");
    store1.addMessage("user", "Hello");
    store2.addMessage("user", "Hello");
    expect(store1.snapshot().prefixHash).toBe(store2.snapshot().prefixHash);
  });

  it("prefix hash changes when messages change", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "Hello");
    const hash1 = store.snapshot().prefixHash;
    store.addMessage("assistant", "Hi there");
    const hash2 = store.snapshot().prefixHash;
    expect(hash1).not.toBe(hash2);
  });

  it("exports messages in canonical format", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("system", "You are helpful.");
    store.addMessage("user", "Hello");
    const msgs = store.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("clears messages", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "test");
    store.clear();
    expect(store.snapshot().messageCount).toBe(0);
  });

  it("removes a specific message by index", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "first");
    store.addMessage("user", "second");
    store.removeMessageAt(0);
    expect(store.snapshot().messageCount).toBe(1);
    expect(store.getMessages()[0]!.content).toBe("second");
  });

  it("switchModel does not clear messages", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "Hello");
    store.switchModel("gemini-2.5-flash");
    expect(store.snapshot().messageCount).toBe(1);
    expect(store.modelId).toBe("gemini-2.5-flash");
  });
});

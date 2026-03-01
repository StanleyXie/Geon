import { describe, it, expect } from "bun:test";
import { StrategyEngine } from "../context/strategy.js";
import { ClientContextStore } from "../context/layer1.js";
import { ProviderCacheTracker } from "../context/layer2.js";
import { KVCacheEstimator } from "../context/layer3.js";

describe("StrategyEngine", () => {
  it("returns a PreparedPayload for a simple session", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("system", "You are helpful.");
    store.addMessage("user", "Hello");
    const l2 = new ProviderCacheTracker("claude-sonnet-4-6");
    const l3 = new KVCacheEstimator("claude-sonnet-4-6");
    const engine = new StrategyEngine(store, l2, l3);

    const payload = engine.prepare();
    expect(payload.messages).toHaveLength(2);
    expect(payload.fullPathSnapshot.client.totalTokens).toBeGreaterThan(0);
    expect(payload.fullPathSnapshot.kvCache.modelName).toBe("claude-sonnet-4-6");
    expect(payload.pruningApplied).toBe(false);
  });

  it("applies pruning when over autoPruneAtPct threshold", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "x ".repeat(100));
    const l2 = new ProviderCacheTracker("claude-sonnet-4-6");
    const l3 = new KVCacheEstimator("claude-sonnet-4-6");
    // Set threshold to 0% so pruning always triggers
    const engine = new StrategyEngine(store, l2, l3, { autoPruneAtPct: 0 });
    const payload = engine.prepare();
    expect(payload.pruningApplied).toBe(true);
  });

  it("FullPathSnapshot has all three layers populated", () => {
    const store = new ClientContextStore("gemini-2.5-flash");
    store.addMessage("user", "Test message");
    const l2 = new ProviderCacheTracker("gemini-2.5-flash");
    const l3 = new KVCacheEstimator("gemini-2.5-flash");
    const engine = new StrategyEngine(store, l2, l3);
    const payload = engine.prepare();
    const snap = payload.fullPathSnapshot;

    expect(snap.client.messageCount).toBe(1);
    expect(snap.cacheState.modelId).toBe("gemini-2.5-flash");
    expect(snap.kvCache.kvCacheBytes).toBeGreaterThan(0);
  });

  it("requestNumber increments on each prepare()", () => {
    const store = new ClientContextStore("claude-sonnet-4-6");
    store.addMessage("user", "hello");
    const engine = new StrategyEngine(store, new ProviderCacheTracker("claude-sonnet-4-6"), new KVCacheEstimator("claude-sonnet-4-6"));
    const p1 = engine.prepare();
    const p2 = engine.prepare();
    expect(p1.requestNumber).toBe(1);
    expect(p2.requestNumber).toBe(2);
  });
});

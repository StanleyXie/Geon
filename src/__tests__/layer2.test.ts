import { describe, it, expect, beforeEach } from "bun:test";
import { ProviderCacheTracker } from "../context/layer2.js";

describe("ProviderCacheTracker", () => {
  let tracker: ProviderCacheTracker;

  beforeEach(() => {
    tracker = new ProviderCacheTracker("claude-sonnet-4-6", { ttlMs: 60_000 });
  });

  it("first request is a MISS", () => {
    const state = tracker.track("hash_abc", 1000, 100);
    expect(state.status).toBe("MISS");
    expect(state.cachedTokens).toBe(0);
    expect(state.uncachedTokens).toBe(1000);
  });

  it("second request with same prefix hash is a HIT", () => {
    tracker.track("hash_abc", 1000, 100);
    const state = tracker.track("hash_abc", 1000, 100);
    expect(state.status).toBe("HIT");
    expect(state.cachedTokens).toBe(1000);
    expect(state.cacheHitPct).toBeCloseTo(100);
  });

  it("different prefix hash is a MISS", () => {
    tracker.track("hash_abc", 1000, 100);
    const state = tracker.track("hash_xyz", 1200, 100);
    expect(state.status).toBe("MISS");
  });

  it("expired entry is EXPIRED", () => {
    const shortTtl = new ProviderCacheTracker("claude-sonnet-4-6", { ttlMs: 1 });
    shortTtl.track("hash_abc", 1000, 100);
    // Force expiry by back-dating entry
    const entry = (shortTtl as any)._cache.get("hash_abc");
    entry.timestamp = Date.now() - 100;
    const state = shortTtl.track("hash_abc", 1000, 100);
    expect(state.status).toBe("EXPIRED");
  });

  it("switch model clears all cache entries", () => {
    tracker.track("hash_abc", 1000, 100);
    tracker.switchModel("gemini-2.5-pro");
    const state = tracker.track("hash_abc", 1000, 100);
    expect(state.status).toBe("MISS");
    expect(tracker.modelId).toBe("gemini-2.5-pro");
  });

  it("computes cost savings on HIT", () => {
    tracker.track("hash_abc", 1000, 100);
    const state = tracker.track("hash_abc", 1000, 100);
    expect(state.estimatedCostSavings).toBeGreaterThan(0);
  });

  it("computes full cost breakdown", () => {
    const breakdown = tracker.computeCost(1000, 200, 800);
    expect(breakdown.inputCost).toBeGreaterThan(0);
    expect(breakdown.outputCost).toBeGreaterThan(0);
    expect(breakdown.totalCost).toBeCloseTo(breakdown.inputCost + breakdown.outputCost + breakdown.cacheWriteCost);
  });
});

import { describe, it, expect } from "bun:test";
import { ModelSwitchAnalyzer } from "../context/switch-analyzer.js";
import { ClientContextStore } from "../context/layer1.js";
import { ProviderCacheTracker } from "../context/layer2.js";
import { KVCacheEstimator } from "../context/layer3.js";

function makeAnalyzer(modelId: string, tokenApprox: number) {
  const store = new ClientContextStore(modelId);
  // Add enough text to approximate token count (1 token ≈ 3.5 chars with gpt-tokenizer)
  store.addMessage("user", "x ".repeat(Math.max(1, tokenApprox)));
  const l2 = new ProviderCacheTracker(modelId);
  const l3 = new KVCacheEstimator(modelId);
  return new ModelSwitchAnalyzer(store, l2, l3);
}

describe("ModelSwitchAnalyzer", () => {
  it("fits_in_new_context is true when session < new model max", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 100);
    const impact = analyzer.analyze("gemini-2.5-pro");
    expect(impact.fitsInNewContext).toBe(true);
    expect(impact.tokensTruncated).toBe(0);
  });

  it("severity is low for small session switch", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 100);
    const impact = analyzer.analyze("gemini-2.5-flash");
    expect(impact.severity).toBe("low");
  });

  it("includes old and new KV cache estimates", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 100);
    const impact = analyzer.analyze("gemini-2.5-pro");
    expect(impact.oldKvCache.modelName).toBe("claude-sonnet-4-6");
    expect(impact.newKvCache.modelName).toBe("gemini-2.5-pro");
    expect(impact.kvCacheInvalidatedMb).toBe(impact.oldKvCache.kvCacheMb);
  });

  it("full_prefill_cost is non-zero", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 100);
    const impact = analyzer.analyze("gemini-2.5-pro");
    expect(impact.fullPrefillCost).toBeGreaterThan(0);
  });

  it("from and to model names are correct", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 100);
    const impact = analyzer.analyze("gemini-2.5-flash");
    expect(impact.fromModel).toBe("claude-sonnet-4-6");
    expect(impact.toModel).toBe("gemini-2.5-flash");
  });

  it("estimatedPrefillLatencyMs is positive", () => {
    const analyzer = makeAnalyzer("claude-sonnet-4-6", 500);
    const impact = analyzer.analyze("gemini-2.5-flash");
    expect(impact.estimatedPrefillLatencyMs).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "bun:test";
import { KVCacheEstimator } from "../context/layer3.js";

describe("KVCacheEstimator", () => {
  it("estimates KV cache bytes for claude-sonnet-4-6", () => {
    const est = new KVCacheEstimator("claude-sonnet-4-6");
    const result = est.estimate(8000);
    // 2 × 80 layers × 8 kv_heads × 128 head_dim × 8000 seq × 2 bytes
    const expected = 2 * 80 * 8 * 128 * 8000 * 2;
    expect(result.kvCacheBytes).toBe(expected);
    expect(result.kvCacheMb).toBeCloseTo(expected / (1024 * 1024), 1);
  });

  it("GQA ratio is correct for claude-sonnet-4-6", () => {
    // 64 Q heads / 8 KV heads = 8
    const est = new KVCacheEstimator("claude-sonnet-4-6");
    const result = est.estimate(1000);
    expect(result.gqaRatio).toBeCloseTo(8);
  });

  it("computes prefill FLOPs", () => {
    const est = new KVCacheEstimator("claude-sonnet-4-6");
    const result = est.estimate(1000);
    // 2 × layers × q_heads × head_dim × seq²
    const expected = 2 * 80 * 64 * 128 * (1000 * 1000);
    expect(result.prefillFlops).toBe(expected);
  });

  it("context utilization reflects sequence vs max context", () => {
    const est = new KVCacheEstimator("claude-sonnet-4-6");
    const result = est.estimate(20_000);
    expect(result.contextUtilizationPct).toBeCloseTo((20_000 / 200_000) * 100, 1);
  });

  it("gemini-2.5-pro has larger KV per token due to head_dim=256", () => {
    const claudeEst = new KVCacheEstimator("claude-sonnet-4-6");
    const geminiEst = new KVCacheEstimator("gemini-2.5-pro");
    const claudeResult = claudeEst.estimate(1000);
    const geminiResult = geminiEst.estimate(1000);
    expect(geminiResult.perTokenBytes).toBeGreaterThan(claudeResult.perTokenBytes);
  });

  it("switchModel changes the model used for estimates", () => {
    const est = new KVCacheEstimator("claude-sonnet-4-6");
    est.switchModel("gemini-2.5-flash");
    expect(est.modelId).toBe("gemini-2.5-flash");
    const result = est.estimate(1000);
    expect(result.modelName).toBe("gemini-2.5-flash");
  });
});

import { getModelSpec, getPricing } from "./model-registry.js";
import { KVCacheEstimator } from "./layer3.js";
import type { ClientContextStore } from "./layer1.js";
import type { ProviderCacheTracker } from "./layer2.js";
import type { SwitchImpact } from "./types.js";

const PREFILL_TOKENS_PER_SEC = 80_000;

export class ModelSwitchAnalyzer {
  constructor(
    private l1: ClientContextStore,
    private l2: ProviderCacheTracker,
    private l3: KVCacheEstimator,
  ) {}

  analyze(toModelId: string): SwitchImpact {
    const fromModelId = this.l1.modelId;
    const snap = this.l1.snapshot();
    const sessionTokens = snap.totalTokens;
    const toSpec = getModelSpec(toModelId);

    const fitsInNewContext = sessionTokens <= toSpec.maxContext;
    const tokensTruncated = fitsInNewContext ? 0 : sessionTokens - toSpec.maxContext;
    const usableTokens = sessionTokens - tokensTruncated;

    // KV cache impact: old cache is fully invalidated on model switch
    const oldKvCache = this.l3.estimate(sessionTokens);
    const newL3 = new KVCacheEstimator(toModelId);
    const newKvCache = newL3.estimate(usableTokens);

    // Cost: full prefill at new model pricing (no cache benefit after switch)
    const toPricing = getPricing(toModelId);
    const fullPrefillCost = toPricing
      ? (usableTokens / 1_000_000) * toPricing.inputPerMillion
      : 0;

    // Cache savings lost from current provider cache
    const l2Stats = this.l2.stats;
    const fromPricing = getPricing(fromModelId);
    const cacheSavingsLost = fromPricing && l2Stats.hits > 0
      ? (usableTokens / 1_000_000) * (fromPricing.inputPerMillion - fromPricing.inputCacheHitPerMillion) * l2Stats.hitRate
      : 0;

    const estimatedPrefillLatencyMs = (usableTokens / PREFILL_TOKENS_PER_SEC) * 1000;

    const utilization = usableTokens / toSpec.maxContext;
    const severity: SwitchImpact["severity"] =
      !fitsInNewContext ? "critical"
      : utilization > 0.8 ? "high"
      : utilization > 0.5 ? "medium"
      : "low";

    const recommendation = !fitsInNewContext
      ? `Warning: Session (${sessionTokens.toLocaleString()} tokens) exceeds ${toModelId} limit (${toSpec.maxContext.toLocaleString()}). ${tokensTruncated.toLocaleString()} tokens will be truncated.`
      : `Switch feasible. ${usableTokens.toLocaleString()} tokens will be re-prefilled (~${Math.round(estimatedPrefillLatencyMs)}ms).`;

    return {
      fromModel: fromModelId, toModel: toModelId,
      sessionTokens, fitsInNewContext, tokensTruncated,
      oldKvCache, newKvCache,
      kvCacheInvalidatedMb: oldKvCache.kvCacheMb,
      fullPrefillCost, cacheSavingsLost, estimatedPrefillLatencyMs,
      recommendation, severity,
    };
  }
}

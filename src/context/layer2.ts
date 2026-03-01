import { getPricing } from "./model-registry.js";
import type { CacheStatus, PromptCacheState } from "./types.js";

interface CacheEntry {
  tokenCount: number;
  timestamp: number;
  prefixHash: string;
}

interface L2Options {
  ttlMs: number;
}

export class ProviderCacheTracker {
  private _modelId: string;
  private _ttlMs: number;
  private _cache = new Map<string, CacheEntry>();
  private _hitCount = 0;
  private _missCount = 0;

  constructor(modelId: string, opts: Partial<L2Options> = {}) {
    this._modelId = modelId;
    this._ttlMs = opts.ttlMs ?? 300_000; // 5 min default (matches Anthropic TTL)
  }

  get modelId(): string { return this._modelId; }

  track(prefixHash: string, totalTokens: number, _newTokens: number): PromptCacheState {
    const now = Date.now();
    const existing = this._cache.get(prefixHash);

    let status: CacheStatus;
    let cachedTokens = 0;

    if (existing) {
      const age = now - existing.timestamp;
      if (age > this._ttlMs) {
        status = "EXPIRED";
        this._missCount++;
        this._cache.delete(prefixHash);
      } else {
        status = "HIT";
        cachedTokens = existing.tokenCount;
        this._hitCount++;
      }
    } else {
      status = "MISS";
      this._missCount++;
    }

    if (status === "MISS" || status === "EXPIRED") {
      this._cache.set(prefixHash, { tokenCount: totalTokens, timestamp: now, prefixHash });
    }

    const uncachedTokens = totalTokens - cachedTokens;
    const cacheHitPct = totalTokens > 0 ? (cachedTokens / totalTokens) * 100 : 0;

    const pricing = getPricing(this._modelId);
    let estimatedCostSavings = 0;
    if (pricing && cachedTokens > 0) {
      const fullCost = (cachedTokens / 1_000_000) * pricing.inputPerMillion;
      const cacheCost = (cachedTokens / 1_000_000) * pricing.inputCacheHitPerMillion;
      estimatedCostSavings = fullCost - cacheCost;
    }

    return {
      status, cachedTokens, uncachedTokens, totalTokens,
      cacheHitPct, estimatedCostSavings,
      prefixHash, modelId: this._modelId,
      timestamp: now,
    };
  }

  computeCost(inputTokens: number, outputTokens: number, cachedTokens: number): {
    inputCost: number; outputCost: number; cacheWriteCost: number;
    cacheSavings: number; totalCost: number;
  } {
    const pricing = getPricing(this._modelId);
    if (!pricing) return { inputCost: 0, outputCost: 0, cacheWriteCost: 0, cacheSavings: 0, totalCost: 0 };

    const uncachedInput = inputTokens - cachedTokens;
    const inputCost = (uncachedInput / 1_000_000) * pricing.inputPerMillion
                    + (cachedTokens / 1_000_000) * pricing.inputCacheHitPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheWriteCost = (inputTokens / 1_000_000) * pricing.cacheWritePerMillion;
    const cacheSavings = (cachedTokens / 1_000_000) * (pricing.inputPerMillion - pricing.inputCacheHitPerMillion);
    return { inputCost, outputCost, cacheWriteCost, cacheSavings, totalCost: inputCost + outputCost + cacheWriteCost };
  }

  switchModel(newModelId: string): void {
    this._modelId = newModelId;
    this._cache.clear(); // model switch = guaranteed MISS for all entries
  }

  get stats(): { hits: number; misses: number; hitRate: number } {
    const total = this._hitCount + this._missCount;
    return {
      hits: this._hitCount,
      misses: this._missCount,
      hitRate: total > 0 ? this._hitCount / total : 0,
    };
  }
}

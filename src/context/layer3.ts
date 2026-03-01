import { getModelSpec } from "./model-registry.js";
import type { KVCacheEstimate } from "./types.js";

export class KVCacheEstimator {
  private _modelId: string;

  constructor(modelId: string) {
    this._modelId = modelId;
  }

  get modelId(): string { return this._modelId; }

  estimate(sequenceLength: number): KVCacheEstimate {
    const spec = getModelSpec(this._modelId);

    // KV Cache formula (GQA-aware):
    // bytes = 2 (K and V) × layers × kv_heads × head_dim × seq_len × dtype_bytes
    const kvCacheBytes = 2 * spec.numLayers * spec.numKvHeads * spec.headDim
                       * sequenceLength * spec.dtypeBytes;

    const perLayerBytes = 2 * spec.numKvHeads * spec.headDim * spec.dtypeBytes;
    const perTokenBytes = perLayerBytes * spec.numLayers;

    // Prefill FLOPs: 2 × layers × q_heads × head_dim × seq²
    const prefillFlops = 2 * spec.numLayers * spec.numAttentionHeads
                       * spec.headDim * (sequenceLength * sequenceLength);

    // Per-token decode attention FLOPs
    const attentionFlopsPerToken = 2 * spec.numLayers * spec.numAttentionHeads
                                 * spec.headDim * sequenceLength;

    const kvCacheMb = kvCacheBytes / (1024 * 1024);

    return {
      modelName: this._modelId,
      sequenceLength,
      kvCacheBytes,
      kvCacheMb,
      kvCacheGb: kvCacheMb / 1024,
      perLayerBytes,
      perTokenBytes,
      prefillFlops,
      attentionFlopsPerToken,
      gqaRatio: spec.numAttentionHeads / spec.numKvHeads,
      contextUtilizationPct: (sequenceLength / spec.maxContext) * 100,
      maxContext: spec.maxContext,
    };
  }

  switchModel(newModelId: string): void {
    this._modelId = newModelId;
  }
}

import type { ModelSpec, PricingSpec } from "./types.js";

export const MODEL_SPECS: Record<string, ModelSpec> = {
  // ---- Anthropic-Claude 4.x (via Anthropic API / Claude Agent SDK) ----------
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6",
    provider: "anthropic", numLayers: 80, numAttentionHeads: 64,
    numKvHeads: 8, headDim: 128, maxContext: 200_000, dtypeBytes: 2, vocabSize: 100_277,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6", displayName: "Claude Opus 4.6",
    provider: "anthropic", numLayers: 96, numAttentionHeads: 96,
    numKvHeads: 12, headDim: 128, maxContext: 200_000, dtypeBytes: 2, vocabSize: 100_277,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5",
    provider: "anthropic", numLayers: 48, numAttentionHeads: 48,
    numKvHeads: 8, headDim: 128, maxContext: 200_000, dtypeBytes: 2, vocabSize: 100_277,
  },
  // ---- Google-Gemini 3.x (preview, via Vertex AI / AI Studio) ---------------
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro",
    provider: "google", numLayers: 64, numAttentionHeads: 64,
    numKvHeads: 8, headDim: 256, maxContext: 1_000_000, dtypeBytes: 2, vocabSize: 256_000,
  },
  "gemini-3-pro-preview": {
    id: "gemini-3-pro-preview", displayName: "Gemini 3 Pro",
    provider: "google", numLayers: 64, numAttentionHeads: 64,
    numKvHeads: 8, headDim: 256, maxContext: 1_000_000, dtypeBytes: 2, vocabSize: 256_000,
  },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview", displayName: "Gemini 3 Flash",
    provider: "google", numLayers: 48, numAttentionHeads: 48,
    numKvHeads: 8, headDim: 128, maxContext: 1_000_000, dtypeBytes: 2, vocabSize: 256_000,
  },
  // ---- Google-Gemini 2.5 (stable, via Vertex AI / AI Studio) ----------------
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro",
    provider: "google", numLayers: 64, numAttentionHeads: 64,
    numKvHeads: 8, headDim: 256, maxContext: 1_000_000, dtypeBytes: 2, vocabSize: 256_000,
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash",
    provider: "google", numLayers: 48, numAttentionHeads: 48,
    numKvHeads: 8, headDim: 128, maxContext: 1_000_000, dtypeBytes: 2, vocabSize: 256_000,
  },
  // ---- Local Models (OpenAI-compatible) -------------------------------------
  "qwen3.5-9b": {
    id: "qwen3.5-9b", displayName: "Qwen 3.5 9B (Local)",
    provider: "local", numLayers: 48, numAttentionHeads: 48,
    numKvHeads: 8, headDim: 128, maxContext: 8192, dtypeBytes: 2, vocabSize: 151643,
  },
};

export const PRICING: Record<string, PricingSpec> = {
  "claude-sonnet-4-6": { inputPerMillion: 3.00, inputCacheHitPerMillion: 0.30, outputPerMillion: 15.00, cacheWritePerMillion: 3.75 },
  "claude-opus-4-6": { inputPerMillion: 15.00, inputCacheHitPerMillion: 1.50, outputPerMillion: 75.00, cacheWritePerMillion: 18.75 },
  "claude-haiku-4-5": { inputPerMillion: 0.80, inputCacheHitPerMillion: 0.08, outputPerMillion: 4.00, cacheWritePerMillion: 1.00 },
  "gemini-3.1-pro-preview": { inputPerMillion: 1.25, inputCacheHitPerMillion: 0.315, outputPerMillion: 10.00, cacheWritePerMillion: 1.25 },
  "gemini-3-pro-preview": { inputPerMillion: 1.25, inputCacheHitPerMillion: 0.315, outputPerMillion: 10.00, cacheWritePerMillion: 1.25 },
  "gemini-3-flash-preview": { inputPerMillion: 0.15, inputCacheHitPerMillion: 0.0375, outputPerMillion: 0.60, cacheWritePerMillion: 0.15 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, inputCacheHitPerMillion: 0.315, outputPerMillion: 10.00, cacheWritePerMillion: 1.25 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, inputCacheHitPerMillion: 0.0375, outputPerMillion: 0.60, cacheWritePerMillion: 0.15 },
};

export function getModelSpec(modelId: string): ModelSpec {
  const spec = MODEL_SPECS[modelId];
  if (!spec) throw new Error(`Unknown model: ${modelId}`);
  return spec;
}

export function getPricing(modelId: string): PricingSpec | undefined {
  return PRICING[modelId];
}

export function resolveModelId(id: string): string {
  return id;
}

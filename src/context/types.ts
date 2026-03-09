export type Provider = "anthropic" | "google" | "local" | "llama_cpp" | "lmstudio";
export type MessageRole = "system" | "user" | "assistant" | "tool_call" | "tool_result";

export interface CanonicalMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
  tokenCount: number;
  byteSize: number;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface ModelSpec {
  id: string;
  /** Actual model ID to pass to the provider API. Defaults to id when omitted. */
  apiModelId?: string;
  displayName: string;
  provider: Provider;
  numLayers: number;
  numAttentionHeads: number;
  numKvHeads: number;
  headDim: number;
  maxContext: number;
  dtypeBytes: number;
  vocabSize: number;
}

export interface PricingSpec {
  inputPerMillion: number;
  inputCacheHitPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
}

export interface ContextSnapshot {
  totalTokens: number;
  totalBytes: number;
  messageCount: number;
  tokensByRole: Record<MessageRole, number>;
  contextLimit: number;
  utilizationPct: number;
  headroomTokens: number;
  largestMessageTokens: number;
  avgTokensPerTurn: number;
  estimatedTurnsRemaining: number;
  messages: CanonicalMessage[];
  prefixHash: string;
}

export type CacheStatus = "HIT" | "MISS" | "PARTIAL" | "EXPIRED";

export interface PromptCacheState {
  status: CacheStatus;
  cachedTokens: number;
  uncachedTokens: number;
  totalTokens: number;
  cacheHitPct: number;
  estimatedCostSavings: number;
  prefixHash: string;
  modelId: string;
  timestamp: number;
}

export interface KVCacheEstimate {
  modelName: string;
  sequenceLength: number;
  kvCacheBytes: number;
  kvCacheMb: number;
  kvCacheGb: number;
  perLayerBytes: number;
  perTokenBytes: number;
  prefillFlops: number;
  attentionFlopsPerToken: number;
  gqaRatio: number;
  contextUtilizationPct: number;
  maxContext: number;
}

export interface SwitchImpact {
  fromModel: string;
  toModel: string;
  sessionTokens: number;
  fitsInNewContext: boolean;
  tokensTruncated: number;
  oldKvCache: KVCacheEstimate;
  newKvCache: KVCacheEstimate;
  kvCacheInvalidatedMb: number;
  fullPrefillCost: number;
  cacheSavingsLost: number;
  estimatedPrefillLatencyMs: number;
  recommendation: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface BudgetAlert {
  type: "warning" | "critical";
  message: string;
  utilizationPct: number;
}

export interface PruneResult {
  strategy: string;
  messagesRemoved: number;
  tokensFreed: number;
  newTotalTokens: number;
}

export interface FullPathSnapshot {
  client: ContextSnapshot;
  cacheState: PromptCacheState;
  costBreakdown: {
    inputCost: number;
    outputCost: number;
    cacheWriteCost: number;
    totalCost: number;
    cacheSavings: number;
  };
  kvCache: KVCacheEstimate;
  budgetAlerts: BudgetAlert[];
  timestamp: number;
  requestNumber: number;
}

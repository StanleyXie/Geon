import { BudgetManager, PruningStrategy } from "./budget.js";
import type { ClientContextStore } from "./layer1.js";
import type { ProviderCacheTracker } from "./layer2.js";
import type { KVCacheEstimator } from "./layer3.js";
import type { CanonicalMessage, FullPathSnapshot } from "./types.js";

export interface PreparedPayload {
  messages: CanonicalMessage[];
  fullPathSnapshot: FullPathSnapshot;
  pruningApplied: boolean;
  requestNumber: number;
}

export interface StrategyOptions {
  autoPruneAtPct: number;
  pruningStrategy: PruningStrategy;
}

export class StrategyEngine {
  private _requestNumber = 0;
  private _opts: StrategyOptions;
  private _budget: BudgetManager;

  constructor(
    private l1: ClientContextStore,
    private l2: ProviderCacheTracker,
    private l3: KVCacheEstimator,
    opts: Partial<StrategyOptions> = {},
  ) {
    this._opts = { autoPruneAtPct: 90, pruningStrategy: PruningStrategy.SLIDING_WINDOW, ...opts };
    this._budget = new BudgetManager(this.l1, { warningPct: 80, criticalPct: this._opts.autoPruneAtPct });
  }

  prepare(): PreparedPayload {
    this._requestNumber++;
    this.l1.recordRequest();

    let pruningApplied = false;
    const alerts = this._budget.checkBudget();
    if (alerts.some(a => a.type === "critical")) {
      this._budget.prune(this._opts.pruningStrategy);
      pruningApplied = true;
    }

    const snap = this.l1.snapshot();
    const cacheState = this.l2.track(snap.prefixHash, snap.totalTokens, 0);
    const kvCache = this.l3.estimate(snap.totalTokens);
    const costBreakdown = this.l2.computeCost(snap.totalTokens, 0, cacheState.cachedTokens);
    const budgetAlerts = this._budget.checkBudget();

    const fullPathSnapshot: FullPathSnapshot = {
      client: snap,
      cacheState,
      costBreakdown,
      kvCache,
      budgetAlerts,
      timestamp: Date.now(),
      requestNumber: this._requestNumber,
    };

    return {
      messages: snap.messages,
      fullPathSnapshot,
      pruningApplied,
      requestNumber: this._requestNumber,
    };
  }
}

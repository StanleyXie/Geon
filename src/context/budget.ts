import type { ClientContextStore } from "./layer1.js";
import type { BudgetAlert, PruneResult } from "./types.js";

export enum PruningStrategy {
  FIFO           = "fifo",
  SLIDING_WINDOW = "sliding_window",
  // Phase 1.5: DROP_TOOL_RESULTS, DROP_LARGEST, KEEP_BOOKENDS, SUMMARIZE_PREFIX
}

export interface BudgetConfig {
  warningPct: number;
  criticalPct: number;
}

export class BudgetManager {
  private _config: BudgetConfig;

  constructor(
    private store: ClientContextStore,
    config: Partial<BudgetConfig> = {},
  ) {
    this._config = { warningPct: 80, criticalPct: 95, ...config };
  }

  checkBudget(): BudgetAlert[] {
    const snap = this.store.snapshot();
    const alerts: BudgetAlert[] = [];
    if (snap.utilizationPct >= this._config.criticalPct) {
      alerts.push({ type: "critical", message: `Context at ${snap.utilizationPct.toFixed(1)}% — prune immediately`, utilizationPct: snap.utilizationPct });
    } else if (snap.utilizationPct >= this._config.warningPct) {
      alerts.push({ type: "warning", message: `Context at ${snap.utilizationPct.toFixed(1)}% — consider pruning`, utilizationPct: snap.utilizationPct });
    }
    return alerts;
  }

  prune(strategy: PruningStrategy, parameter = 5): PruneResult {
    const before = this.store.snapshot();

    switch (strategy) {
      case PruningStrategy.FIFO:
        this._pruneFifo(parameter);
        break;
      case PruningStrategy.SLIDING_WINDOW:
        this._pruneSlidingWindow(parameter);
        break;
    }

    const after = this.store.snapshot();
    return {
      strategy,
      messagesRemoved: before.messageCount - after.messageCount,
      tokensFreed: before.totalTokens - after.totalTokens,
      newTotalTokens: after.totalTokens,
    };
  }

  private _pruneFifo(count: number): void {
    let removed = 0;
    let i = 0;
    while (removed < count) {
      const msgs = this.store.getMessages();
      if (i >= msgs.length) break;
      if (msgs[i]!.role !== "system") {
        this.store.removeMessageAt(i);
        removed++;
        // don't increment i — array shifted left after removal
      } else {
        i++;
      }
    }
  }

  private _pruneSlidingWindow(keepTurns: number): void {
    const msgs = this.store.getMessages();
    const nonSystem = msgs
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.role !== "system");

    const keepCount = keepTurns * 2; // each turn = user + assistant
    const toRemove = nonSystem.slice(0, Math.max(0, nonSystem.length - keepCount));

    // Remove from back to front to preserve indices during removal
    for (const { i } of toRemove.reverse()) {
      this.store.removeMessageAt(i);
    }
  }
}

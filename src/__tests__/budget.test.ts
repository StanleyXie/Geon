import { describe, it, expect } from "bun:test";
import { BudgetManager, PruningStrategy } from "../context/budget.js";
import { ClientContextStore } from "../context/layer1.js";

function storeWith(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>): ClientContextStore {
  const store = new ClientContextStore("claude-sonnet-4-6");
  for (const m of messages) store.addMessage(m.role, m.content);
  return store;
}

describe("BudgetManager", () => {
  it("returns no alerts when under threshold", () => {
    const store = storeWith([{ role: "user", content: "hello" }]);
    const mgr = new BudgetManager(store, { warningPct: 80, criticalPct: 95 });
    const alerts = mgr.checkBudget();
    expect(alerts).toHaveLength(0);
  });

  it("FIFO removes oldest non-system messages", () => {
    const store = storeWith([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Message 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "Message 2" },
      { role: "assistant", content: "Reply 2" },
    ]);
    const mgr = new BudgetManager(store);
    const result = mgr.prune(PruningStrategy.FIFO, 2);
    expect(result.messagesRemoved).toBe(2);
    // system message preserved
    expect(store.getMessages()[0]!.role).toBe("system");
  });

  it("SLIDING_WINDOW keeps system + last N turns", () => {
    const store = storeWith([
      { role: "system", content: "System." },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
      { role: "user", content: "U3" },
      { role: "assistant", content: "A3" },
    ]);
    const mgr = new BudgetManager(store);
    mgr.prune(PruningStrategy.SLIDING_WINDOW, 2); // keep last 2 turns
    const msgs = store.getMessages();
    expect(msgs[0]!.role).toBe("system");
    // Last message should be A3, second-to-last U3
    expect(msgs[msgs.length - 1]!.content).toBe("A3");
    expect(msgs[msgs.length - 2]!.content).toBe("U3");
  });

  it("FIFO does not remove system messages", () => {
    const store = storeWith([
      { role: "system", content: "System." },
      { role: "user", content: "User." },
    ]);
    const mgr = new BudgetManager(store);
    mgr.prune(PruningStrategy.FIFO, 5); // try to remove 5, only 1 non-system exists
    const msgs = store.getMessages();
    expect(msgs.some(m => m.role === "system")).toBe(true);
  });

  it("prune returns correct tokensFreed", () => {
    const store = storeWith([
      { role: "user", content: "first message here" },
      { role: "assistant", content: "second message here" },
    ]);
    const mgr = new BudgetManager(store);
    const before = store.snapshot().totalTokens;
    const result = mgr.prune(PruningStrategy.FIFO, 1);
    const after = store.snapshot().totalTokens;
    expect(result.tokensFreed).toBe(before - after);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });
});

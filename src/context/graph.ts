import { randomUUID } from "node:crypto";
import { ClientContextStore } from "./layer1.js";
import { ProviderCacheTracker } from "./layer2.js";
import { KVCacheEstimator } from "./layer3.js";
import { StrategyEngine } from "./strategy.js";
import type { CanonicalMessage } from "./types.js";

export class ContextNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly model: string;
  readonly createdAt: number;
  readonly store: ClientContextStore;
  readonly l2: ProviderCacheTracker;
  readonly l3: KVCacheEstimator;
  readonly engine: StrategyEngine;

  constructor(data: {
    id: string;
    parentId: string | null;
    model: string;
    createdAt: number;
    store: ClientContextStore;
    l2: ProviderCacheTracker;
    l3: KVCacheEstimator;
    engine: StrategyEngine;
  }) {
    this.id = data.id;
    this.parentId = data.parentId;
    this.model = data.model;
    this.createdAt = data.createdAt;
    this.store = data.store;
    this.l2 = data.l2;
    this.l3 = data.l3;
    this.engine = data.engine;
  }

  addMessage(role: CanonicalMessage["role"], content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
    return this.store.addMessage(role, content, metadata);
  }

  switchModel(newModelId: string): void {
    this.store.switchModel(newModelId);
    this.l2.switchModel(newModelId);
    this.l3.switchModel(newModelId);
  }
}

// Phase 2 note: fork() and merge() will be added here
export class ContextGraph {
  private _nodes = new Map<string, ContextNode>();
  private _rootId: string;
  private _activeNodeId: string;

  private constructor(root: ContextNode) {
    this._nodes.set(root.id, root);
    this._rootId = root.id;
    this._activeNodeId = root.id;
  }

  static create(modelId: string): ContextGraph {
    const id = randomUUID();
    const store = new ClientContextStore(modelId);
    const l2 = new ProviderCacheTracker(modelId);
    const l3 = new KVCacheEstimator(modelId);
    const engine = new StrategyEngine(store, l2, l3);
    const root = new ContextNode({ id, parentId: null, model: modelId, createdAt: Date.now(), store, l2, l3, engine });
    return new ContextGraph(root);
  }

  get root(): ContextNode {
    return this._nodes.get(this._rootId)!;
  }

  get activeNode(): ContextNode {
    return this._nodes.get(this._activeNodeId)!;
  }

  get nodeCount(): number {
    return this._nodes.size;
  }

  getNode(id: string): ContextNode | undefined {
    return this._nodes.get(id);
  }
}

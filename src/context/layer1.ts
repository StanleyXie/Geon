import { encode } from "gpt-tokenizer";
import { createHash } from "node:crypto";
import { getModelSpec } from "./model-registry.js";
import type { CanonicalMessage, ContextSnapshot, MessageRole } from "./types.js";

function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 3.5);
  }
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function computePrefixHash(messages: CanonicalMessage[]): string {
  const combined = messages.map(m => `${m.role}:${m.contentHash}`).join("|");
  return createHash("sha256").update(combined).digest("hex").slice(0, 16);
}

export class ClientContextStore {
  private _messages: CanonicalMessage[] = [];
  private _totalTokens = 0;
  private _modelId: string;
  private _requestCount = 0;

  constructor(modelId: string) {
    this._modelId = modelId;
  }

  get modelId(): string { return this._modelId; }

  addMessage(role: MessageRole, content: string, metadata: Record<string, unknown> = {}): CanonicalMessage {
    const tokenCount = countTokens(content);
    const msg: CanonicalMessage = {
      role, content,
      timestamp: Date.now(),
      tokenCount,
      byteSize: Buffer.byteLength(content, "utf8"),
      contentHash: contentHash(content),
      metadata,
    };
    this._messages.push(msg);
    this._totalTokens += tokenCount;
    return msg;
  }

  removeMessageAt(index: number): void {
    const msg = this._messages[index];
    if (!msg) return;
    this._totalTokens -= msg.tokenCount;
    this._messages.splice(index, 1);
  }

  clear(): void {
    this._messages = [];
    this._totalTokens = 0;
  }

  getMessages(): CanonicalMessage[] {
    return [...this._messages];
  }

  snapshot(): ContextSnapshot {
    const spec = getModelSpec(this._modelId);
    const tokensByRole = {} as Record<MessageRole, number>;
    for (const msg of this._messages) {
      tokensByRole[msg.role] = (tokensByRole[msg.role] ?? 0) + msg.tokenCount;
    }
    const turns = this._messages.filter(m => m.role === "user").length;
    const avgPerTurn = turns > 0 ? this._totalTokens / turns : 0;
    const largest = this._messages.reduce((max, m) => Math.max(max, m.tokenCount), 0);
    const headroom = spec.maxContext - this._totalTokens;
    const turnsRemaining = avgPerTurn > 0 ? Math.floor(headroom / avgPerTurn) : 999;

    return {
      totalTokens: this._totalTokens,
      totalBytes: this._messages.reduce((s, m) => s + m.byteSize, 0),
      messageCount: this._messages.length,
      tokensByRole,
      contextLimit: spec.maxContext,
      utilizationPct: (this._totalTokens / spec.maxContext) * 100,
      headroomTokens: headroom,
      largestMessageTokens: largest,
      avgTokensPerTurn: avgPerTurn,
      estimatedTurnsRemaining: turnsRemaining,
      messages: this.getMessages(),
      prefixHash: computePrefixHash(this._messages),
    };
  }

  switchModel(newModelId: string): void {
    this._modelId = newModelId;
    // L1 messages are unchanged — they survive model switches
  }

  recordRequest(): void {
    this._requestCount++;
  }

  get requestCount(): number { return this._requestCount; }
}

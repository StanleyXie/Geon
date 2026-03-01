import { createHash } from "node:crypto";

export function hashCwd(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex");
}

export class Pushable<T> implements AsyncIterable<T> {
  private _queue: T[] = [];
  private _resolve: ((value: IteratorResult<T>) => void) | null = null;
  private _done = false;

  push(value: T): void {
    if (this._resolve) {
      this._resolve({ value, done: false });
      this._resolve = null;
    } else {
      this._queue.push(value);
    }
  }

  end(): void {
    this._done = true;
    if (this._resolve) {
      this._resolve({ value: undefined as any, done: true });
      this._resolve = null;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this._queue.length > 0) {
          return Promise.resolve({ value: this._queue.shift()!, done: false });
        }
        if (this._done) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise(resolve => { this._resolve = resolve; });
      },
    };
  }
}

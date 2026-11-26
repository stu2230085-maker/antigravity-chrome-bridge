import { DEFAULT_TRACE_BUFFER_SIZE, type TraceEntry } from '@antigravity-bridge/protocol';
import type { BridgeEventBus } from './event-bus.js';

export class TraceStore {
  private readonly maxEntries: number;
  private readonly entries: TraceEntry[] = [];

  constructor(
    maxEntries = DEFAULT_TRACE_BUFFER_SIZE,
    private readonly eventBus?: BridgeEventBus,
  ) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  record(entry: TraceEntry): void {
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(entry);
    this.eventBus?.emitTrace(entry);
  }

  list(limit?: number): TraceEntry[] {
    const items = [...this.entries].reverse();
    if (limit !== undefined && limit > 0) {
      return items.slice(0, limit);
    }
    return items;
  }

  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}

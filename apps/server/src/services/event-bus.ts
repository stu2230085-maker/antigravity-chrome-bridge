import type { SessionSummary, TraceEntry } from '@antigravity-bridge/protocol';

export type BridgeEvent =
  | { type: 'trace'; data: TraceEntry }
  | { type: 'sessions'; data: SessionSummary[] };

export type BridgeEventListener = (event: BridgeEvent) => void;

export class BridgeEventBus {
  private readonly listeners = new Set<BridgeEventListener>();
  private readonly closeHandlers = new Set<() => void>();

  subscribe(listener: BridgeEventListener, onClose?: () => void): () => void {
    this.listeners.add(listener);
    if (onClose) {
      this.closeHandlers.add(onClose);
    }
    return () => {
      this.listeners.delete(listener);
      if (onClose) {
        this.closeHandlers.delete(onClose);
      }
    };
  }

  emitTrace(entry: TraceEntry): void {
    this.emit({ type: 'trace', data: entry });
  }

  emitSessions(sessions: SessionSummary[]): void {
    this.emit({ type: 'sessions', data: sessions });
  }

  private emit(event: BridgeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors from core bridge flow
      }
    }
  }

  closeAll(): void {
    for (const close of [...this.closeHandlers]) {
      try {
        close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.closeHandlers.clear();
    this.listeners.clear();
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

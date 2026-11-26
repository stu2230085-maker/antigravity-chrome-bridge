import crypto from 'node:crypto';
import type { SessionSummary, WsCommandEnvelope } from '@antigravity-bridge/protocol';
import { WebSocket } from 'ws';
import type { Logger } from '../logger.js';
import type { TraceStore } from './trace-store.js';

export interface ExtensionSession {
  sessionId: string;
  profile: string;
  ws: WebSocket;
  connectedAt: number;
  lastSeenAt: number;
  remoteAddress?: string;
  version?: string;
}

interface PendingCommand {
  id: string;
  sessionId: string;
  action: string;
  startedAt: number;
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NoConnectedSessionError extends Error {
  constructor(message = 'Chrome extension is not connected') {
    super(message);
    this.name = 'NoConnectedSessionError';
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, ExtensionSession>();
  private readonly socketToSessionId = new Map<WebSocket, string>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private activeSessionId: string | null = null;

  constructor(
    private readonly commandTimeoutMs: number,
    private readonly traceStore: TraceStore,
    private readonly logger: Logger,
  ) {}

  registerConnection(ws: WebSocket, remoteAddress?: string): ExtensionSession {
    const sessionId = `session-${crypto.randomUUID()}`;
    const now = Date.now();
    const session: ExtensionSession = {
      sessionId,
      profile: 'default',
      ws,
      connectedAt: now,
      lastSeenAt: now,
      remoteAddress,
    };

    this.sessions.set(sessionId, session);
    this.socketToSessionId.set(ws, sessionId);
    this.activeSessionId = sessionId;
    return session;
  }

  updateSessionMetadata(
    ws: WebSocket,
    metadata: { sessionId?: string; profile?: string; version?: string },
  ): ExtensionSession | undefined {
    const currentId = this.socketToSessionId.get(ws);
    if (!currentId) return undefined;
    const session = this.sessions.get(currentId);
    if (!session) return undefined;

    session.lastSeenAt = Date.now();
    if (metadata.profile) {
      session.profile = metadata.profile;
    }
    if (metadata.version) {
      session.version = metadata.version;
    }

    // Re-key if the client supplied a deterministic sessionId
    if (metadata.sessionId && metadata.sessionId !== currentId) {
      const existing = this.sessions.get(metadata.sessionId);
      if (existing && existing.ws !== ws) {
        this.logger.warn(
          `Session "${metadata.sessionId}" already connected — replacing old connection`,
        );
        this.disconnectSocket(existing.ws, 'Replaced by new connection with same sessionId');
        if (existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close(1000, 'Replaced by new connection');
        }
      }

      this.sessions.delete(currentId);
      session.sessionId = metadata.sessionId;
      this.sessions.set(metadata.sessionId, session);
      this.socketToSessionId.set(ws, metadata.sessionId);
      if (this.activeSessionId === currentId) {
        this.activeSessionId = metadata.sessionId;
      }

      // Update any in-flight pending commands attached to old generated ID
      for (const pending of this.pendingCommands.values()) {
        if (pending.sessionId === currentId) {
          pending.sessionId = metadata.sessionId;
        }
      }
    }

    return session;
  }

  touchSocket(ws: WebSocket): void {
    const id = this.socketToSessionId.get(ws);
    if (!id) return;
    const session = this.sessions.get(id);
    if (session) {
      session.lastSeenAt = Date.now();
    }
  }

  getSessionBySocket(ws: WebSocket): ExtensionSession | undefined {
    const id = this.socketToSessionId.get(ws);
    return id ? this.sessions.get(id) : undefined;
  }

  resolveTargetSession(requestedSessionId?: string): ExtensionSession | undefined {
    if (requestedSessionId) {
      const target = this.sessions.get(requestedSessionId);
      if (target && target.ws.readyState === WebSocket.OPEN) {
        return target;
      }
      // Also allow matching by profile name if unique/open
      for (const session of this.sessions.values()) {
        if (session.profile === requestedSessionId && session.ws.readyState === WebSocket.OPEN) {
          return session;
        }
      }
      return undefined;
    }

    if (this.activeSessionId) {
      const active = this.sessions.get(this.activeSessionId);
      if (active && active.ws.readyState === WebSocket.OPEN) {
        return active;
      }
    }

    // Fallback to latest open session
    const openSessions = Array.from(this.sessions.values()).filter(
      (s) => s.ws.readyState === WebSocket.OPEN,
    );
    return openSessions.at(-1);
  }

  hasConnectedSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  getPendingCount(): number {
    return this.pendingCommands.size;
  }

  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.ws.readyState === WebSocket.OPEN)
      .map((s) => ({
        sessionId: s.sessionId,
        profile: s.profile,
        connectedAt: s.connectedAt,
        lastSeenAt: s.lastSeenAt,
        remoteAddress: s.remoteAddress,
        version: s.version,
        active: s.sessionId === this.activeSessionId,
      }));
  }

  sendCommand(
    action: string,
    params: Record<string, unknown> = {},
    requestedSessionId?: string,
  ): Promise<{ id: string; sessionId: string; result: Record<string, unknown> }> {
    const session = this.resolveTargetSession(requestedSessionId);
    if (!session) {
      throw new NoConnectedSessionError(
        requestedSessionId
          ? `Chrome extension session "${requestedSessionId}" is not connected`
          : 'Chrome extension is not connected',
      );
    }

    const commandId = crypto.randomUUID();
    const startedAt = Date.now();
    const envelope: WsCommandEnvelope = {
      id: commandId,
      action,
      params,
      sessionId: session.sessionId,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        const errorMsg = `Command timed out after ${this.commandTimeoutMs / 1000}s`;
        this.traceStore.record({
          id: commandId,
          sessionId: session.sessionId,
          action,
          startedAt,
          durationMs: Date.now() - startedAt,
          success: false,
          error: errorMsg,
        });
        reject(new Error(errorMsg));
      }, this.commandTimeoutMs);

      this.pendingCommands.set(commandId, {
        id: commandId,
        sessionId: session.sessionId,
        action,
        startedAt,
        resolve: (result) => resolve({ id: commandId, sessionId: session.sessionId, result }),
        reject,
        timer,
      });

      try {
        session.ws.send(JSON.stringify(envelope));
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(commandId);
        const message = err instanceof Error ? err.message : String(err);
        const sendErr = new Error(`Failed to send command: ${message}`);
        this.traceStore.record({
          id: commandId,
          sessionId: session.sessionId,
          action,
          startedAt,
          durationMs: Date.now() - startedAt,
          success: false,
          error: sendErr.message,
        });
        reject(sendErr);
      }
    });
  }

  resolveCommandResponse(ws: WebSocket, response: Record<string, unknown>): boolean {
    const id = typeof response.id === 'string' ? response.id : undefined;
    if (!id) return false;

    const pending = this.pendingCommands.get(id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingCommands.delete(id);
    this.touchSocket(ws);

    const success = response.success !== false;
    const error = typeof response.error === 'string' ? response.error : undefined;

    this.traceStore.record({
      id: pending.id,
      sessionId: pending.sessionId,
      action: pending.action,
      startedAt: pending.startedAt,
      durationMs: Date.now() - pending.startedAt,
      success,
      error,
    });

    pending.resolve(response);
    return true;
  }

  disconnectSocket(
    ws: WebSocket,
    reason = 'Extension disconnected while waiting for response',
  ): void {
    const sessionId = this.socketToSessionId.get(ws);
    if (!sessionId) return;

    this.socketToSessionId.delete(ws);
    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      const remaining = Array.from(this.sessions.keys());
      this.activeSessionId = remaining.at(-1) ?? null;
    }

    for (const [cmdId, pending] of this.pendingCommands) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(cmdId);
        this.traceStore.record({
          id: pending.id,
          sessionId: pending.sessionId,
          action: pending.action,
          startedAt: pending.startedAt,
          durationMs: Date.now() - pending.startedAt,
          success: false,
          error: reason,
        });
        pending.reject(new Error(reason));
      }
    }
  }

  rejectAllPending(reason = 'Server shutting down'): void {
    for (const [cmdId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      this.pendingCommands.delete(cmdId);
      pending.reject(new Error(reason));
    }
  }
}

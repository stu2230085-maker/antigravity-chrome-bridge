import {
  DEFAULT_WS_URL,
  KEEPALIVE_ALARM_NAME,
  KEEPALIVE_ALARM_PERIOD_MINUTES,
  KEEPALIVE_INTERVAL_MS,
} from '@antigravity-bridge/protocol';
import { executeCommand } from '../engines/scripting/index.js';
import { recorderManager } from '../recorder/recorder-manager.js';
import { getCurrentGroupId } from './tab-group.js';

const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

export interface BridgeStatus {
  connected: boolean;
  groupId: number | null;
  profileName: string;
  sessionId: string | null;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private connectInFlight: Promise<void> | null = null;
  private isConnected = false;
  private manualDisconnect = false;
  private reconnectAttempts = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private profileName = 'default';

  async getStoredSettings(): Promise<{
    serverUrl: string;
    profileName: string;
    sessionId: string;
    authToken: string;
  }> {
    const stored = await chrome.storage.local.get({
      serverUrl: DEFAULT_WS_URL,
      profileName: 'default',
      sessionId: '',
      authToken: '',
    });

    let sessionId =
      typeof stored.sessionId === 'string' && stored.sessionId ? stored.sessionId : '';
    if (!sessionId) {
      sessionId = `ext-${crypto.randomUUID()}`;
      await chrome.storage.local.set({ sessionId });
    }

    const profileName =
      typeof stored.profileName === 'string' && stored.profileName.trim()
        ? stored.profileName.trim()
        : 'default';

    const authToken = typeof stored.authToken === 'string' ? stored.authToken.trim() : '';

    this.sessionId = sessionId;
    this.profileName = profileName;

    return {
      serverUrl:
        typeof stored.serverUrl === 'string' && stored.serverUrl
          ? stored.serverUrl
          : DEFAULT_WS_URL,
      profileName,
      sessionId,
      authToken,
    };
  }

  async ensureKeepaliveAlarm(): Promise<void> {
    if (!chrome.alarms) return;
    try {
      const existing = await chrome.alarms.get(KEEPALIVE_ALARM_NAME);
      if (!existing) {
        chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
          periodInMinutes: KEEPALIVE_ALARM_PERIOD_MINUTES,
        });
      }
    } catch (err) {
      console.warn('[Antigravity WARN] Could not create keepalive alarm:', err);
    }
  }

  async connect(force = false): Promise<void> {
    if (force) {
      this.manualDisconnect = false;
    }
    if (this.manualDisconnect) {
      return;
    }
    if (this.connectInFlight) {
      return this.connectInFlight;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.connectInFlight = (async () => {
      try {
        await this.ensureKeepaliveAlarm();
        const { serverUrl, profileName, sessionId, authToken } = await this.getStoredSettings();
        if (this.manualDisconnect) {
          return;
        }
        if (
          this.ws &&
          (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
        ) {
          return;
        }
        console.log(`[Antigravity INFO] Connecting to ${serverUrl}...`);

        try {
          this.ws = new WebSocket(serverUrl);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[Antigravity ERROR] Failed to create WebSocket:', message);
          this.scheduleReconnect();
          return;
        }

        const socket = this.ws;

        socket.onopen = () => {
          console.log('[Antigravity INFO] Connected to bridge server ✓');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.clearReconnectTimer();
          this.startKeepalive();

          const version = chrome.runtime.getManifest?.().version ?? '2.0.0';
          socket.send(
            JSON.stringify({
              type: 'hello',
              sessionId,
              profile: profileName,
              version,
              timestamp: Date.now(),
              ...(authToken ? { token: authToken } : {}),
            }),
          );

          this.broadcastStatus();
        };

        socket.onmessage = async (event: MessageEvent<string>) => {
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            console.error('[Antigravity ERROR] Invalid JSON received:', event.data);
            return;
          }

          if (
            message.type === 'keepalive_ack' ||
            message.type === 'keepalive' ||
            message.type === 'pong'
          ) {
            return;
          }

          if (message.type === 'bridge_ready') {
            if (typeof message.sessionId === 'string' && message.sessionId) {
              this.sessionId = message.sessionId;
            }
            this.broadcastStatus();
            return;
          }

          if (typeof message.id === 'string' && typeof message.action === 'string') {
            const commandId = message.id;
            const action = message.action;
            const params =
              message.params && typeof message.params === 'object' && !Array.isArray(message.params)
                ? (message.params as Record<string, unknown>)
                : {};

            console.log(`[Antigravity INFO] Command received: [${commandId}] ${action}`);
            const startedAt = Date.now();
            let result: Record<string, unknown>;
            try {
              result = await executeCommand({ id: commandId, action, params });
              console.log(`[Antigravity INFO] Command completed: [${commandId}] ${action}`);
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error(`[Antigravity ERROR] Command failed: [${commandId}]`, errorMsg);
              result = { success: false, error: errorMsg };
            }

            recorderManager.recordCommandExecution({
              id: commandId,
              action,
              success: result.success !== false,
              durationMs: Date.now() - startedAt,
              timestamp: Date.now(),
              ...(typeof result.error === 'string' ? { error: result.error } : {}),
              source: 'ws',
            });

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ id: commandId, ...result }));
            }
          }
        };

        socket.onclose = (event: CloseEvent) => {
          console.warn(`[Antigravity WARN] Disconnected (code: ${event.code})`);
          if (this.ws === socket) {
            this.ws = null;
          }
          this.isConnected = false;
          this.stopKeepalive();
          this.broadcastStatus();
          if (!this.manualDisconnect) {
            this.scheduleReconnect();
          }
        };

        socket.onerror = () => {
          console.error('[Antigravity ERROR] WebSocket error');
        };
      } finally {
        this.connectInFlight = null;
      }
    })();

    return this.connectInFlight;
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.stopKeepalive();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.broadcastStatus();
    console.log('[Antigravity INFO] Disconnected manually');
  }

  async handleKeepaliveAlarm(): Promise<void> {
    if (this.manualDisconnect) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'keepalive',
          sessionId: this.sessionId ?? undefined,
          timestamp: Date.now(),
        }),
      );
      return;
    }

    await this.connect();
  }

  getStatus(): BridgeStatus {
    return {
      connected: this.isConnected,
      groupId: getCurrentGroupId(),
      profileName: this.profileName,
      sessionId: this.sessionId,
    };
  }

  broadcastStatus(): void {
    const status = {
      type: 'status_update',
      ...this.getStatus(),
    };
    chrome.runtime.sendMessage(status).catch(() => {
      // Popup may not be open — ignore
    });
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'keepalive',
            sessionId: this.sessionId ?? undefined,
            timestamp: Date.now(),
          }),
        );
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

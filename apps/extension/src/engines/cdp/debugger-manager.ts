import { DEFAULT_CDP_IDLE_DETACH_MS } from '@antigravity-bridge/protocol';

const CDP_PROTOCOL_VERSION = '1.3';

interface AttachedTabState {
  domainsEnabled: boolean;
  telemetryPinned: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
}

class DebuggerManager {
  private readonly attachedTabs = new Map<number, AttachedTabState>();
  private readonly attachInFlight = new Map<number, Promise<void>>();
  private listenersRegistered = false;
  private idleDetachMs: number;

  constructor(idleDetachMs = DEFAULT_CDP_IDLE_DETACH_MS) {
    this.idleDetachMs = idleDetachMs;
  }

  setIdleTimeoutMsForTest(ms: number): void {
    this.idleDetachMs = ms;
  }

  private clearIdleTimer(tabId: number): void {
    const state = this.attachedTabs.get(tabId);
    if (state?.idleTimer !== undefined) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }
  }

  private clearAllIdleTimers(): void {
    for (const state of this.attachedTabs.values()) {
      if (state.idleTimer !== undefined) {
        clearTimeout(state.idleTimer);
        state.idleTimer = undefined;
      }
    }
  }

  private refreshIdleTimer(tabId: number): void {
    const state = this.attachedTabs.get(tabId);
    if (!state || state.telemetryPinned) {
      return;
    }
    this.clearIdleTimer(tabId);
    if (this.idleDetachMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      state.idleTimer = undefined;
      if (!state.telemetryPinned) {
        void this.detach(tabId);
      }
    }, this.idleDetachMs);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref?: () => void }).unref?.();
    }
    state.idleTimer = timer;
  }

  private ensureListeners(): void {
    if (this.listenersRegistered) return;
    if (typeof chrome === 'undefined') return;

    if (chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId !== undefined) {
          this.clearIdleTimer(source.tabId);
          this.attachedTabs.delete(source.tabId);
        }
      });
    }

    if (chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        this.clearIdleTimer(tabId);
        this.attachedTabs.delete(tabId);
      });
    }

    this.listenersRegistered = true;
  }

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  pinTelemetry(tabId: number): void {
    const state = this.attachedTabs.get(tabId);
    if (!state) return;
    state.telemetryPinned = true;
    this.clearIdleTimer(tabId);
  }

  async ensureAttached(tabId: number): Promise<void> {
    this.ensureListeners();

    const existingState = this.attachedTabs.get(tabId);
    if (existingState?.domainsEnabled) {
      return;
    }

    const pending = this.attachInFlight.get(tabId);
    if (pending) {
      return pending;
    }

    const attachPromise = (async () => {
      try {
        if (!this.attachedTabs.has(tabId)) {
          await chrome.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION);
          this.attachedTabs.set(tabId, { domainsEnabled: false, telemetryPinned: false });
        }

        const state = this.attachedTabs.get(tabId);
        if (state && !state.domainsEnabled) {
          await Promise.all([
            chrome.debugger.sendCommand({ tabId }, 'Runtime.enable'),
            chrome.debugger.sendCommand({ tabId }, 'Network.enable'),
            chrome.debugger.sendCommand({ tabId }, 'Page.enable'),
            chrome.debugger.sendCommand({ tabId }, 'DOM.enable'),
          ]);
          state.domainsEnabled = true;
        }
      } catch (err) {
        this.clearIdleTimer(tabId);
        this.attachedTabs.delete(tabId);
        throw err;
      } finally {
        this.attachInFlight.delete(tabId);
      }
    })();

    this.attachInFlight.set(tabId, attachPromise);
    return attachPromise;
  }

  async sendCdpCommand<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureAttached(tabId);
    this.clearIdleTimer(tabId);
    try {
      return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
    } finally {
      this.refreshIdleTimer(tabId);
    }
  }

  async detach(tabId: number): Promise<void> {
    this.clearIdleTimer(tabId);
    this.attachedTabs.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Ignore if already detached
    }
  }

  resetForTest(): void {
    this.clearAllIdleTimers();
    this.attachedTabs.clear();
    this.attachInFlight.clear();
    this.listenersRegistered = false;
    this.idleDetachMs = DEFAULT_CDP_IDLE_DETACH_MS;
  }
}

export const debuggerManager = new DebuggerManager();

export function sendCdpCommand<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return debuggerManager.sendCdpCommand<T>(tabId, method, params);
}

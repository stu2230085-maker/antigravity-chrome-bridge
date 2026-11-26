const CDP_PROTOCOL_VERSION = '1.3';

interface AttachedTabState {
  domainsEnabled: boolean;
}

class DebuggerManager {
  private readonly attachedTabs = new Map<number, AttachedTabState>();
  private readonly attachInFlight = new Map<number, Promise<void>>();
  private listenersRegistered = false;

  private ensureListeners(): void {
    if (this.listenersRegistered) return;
    if (typeof chrome === 'undefined') return;

    if (chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId !== undefined) {
          this.attachedTabs.delete(source.tabId);
        }
      });
    }

    if (chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        this.attachedTabs.delete(tabId);
      });
    }

    this.listenersRegistered = true;
  }

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
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
          this.attachedTabs.set(tabId, { domainsEnabled: false });
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
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  }

  async detach(tabId: number): Promise<void> {
    this.attachedTabs.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Ignore if already detached
    }
  }

  resetForTest(): void {
    this.attachedTabs.clear();
    this.attachInFlight.clear();
    this.listenersRegistered = false;
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

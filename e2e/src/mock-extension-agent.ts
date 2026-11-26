import type {
  ConsoleLogEntry,
  NetworkLogEntry,
  SnapshotElement,
} from '@antigravity-bridge/protocol';
import { WebSocket } from 'ws';

export interface SimulatedElement extends SnapshotElement {
  selector: string;
}

export interface SimulatedTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  inGroup: boolean;
  elements: SimulatedElement[];
  consoleLogs: ConsoleLogEntry[];
  networkLogs: NetworkLogEntry[];
}

export interface MockExtensionAgentOptions {
  wsUrl: string;
  sessionId: string;
  profile: string;
  version?: string;
  token?: string;
  initialUrl?: string;
  initialTitle?: string;
}

const DEFAULT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createElementsForUrl(url: string, profile: string): SimulatedElement[] {
  return [
    {
      ref: '@e1',
      role: 'textbox',
      tagName: 'input',
      selector: '#query',
      label: 'Search query',
      text: '',
      value: '',
      placeholder: `Search in ${profile} (${url})`,
      visible: true,
      rect: { x: 24, y: 40, width: 280, height: 36 },
    },
    {
      ref: '@e2',
      role: 'button',
      tagName: 'button',
      selector: '#submit-btn',
      label: 'Submit Search',
      text: 'Submit Search',
      visible: true,
      rect: { x: 312, y: 40, width: 110, height: 36 },
    },
  ];
}

export class MockExtensionAgent {
  public readonly sessionId: string;
  public readonly profile: string;
  public readonly executedCommands: Array<{
    id: string;
    action: string;
    params: Record<string, unknown>;
  }> = [];

  private ws: WebSocket | null = null;
  private tabs: SimulatedTab[] = [];
  private nextTabId = 101;
  private readonly groupId = 77;
  private submitCount = 0;

  constructor(private readonly options: MockExtensionAgentOptions) {
    this.sessionId = options.sessionId;
    this.profile = options.profile;
    const initialUrl = options.initialUrl ?? `https://example.com/${options.profile}`;
    const initialTitle = options.initialTitle ?? `${options.profile} Home`;

    this.tabs.push({
      id: this.nextTabId++,
      url: initialUrl,
      title: initialTitle,
      active: true,
      inGroup: true,
      elements: createElementsForUrl(initialUrl, this.profile),
      consoleLogs: [
        {
          level: 'info',
          text: `[${this.profile}] Extension initialized`,
          timestamp: Date.now(),
          url: initialUrl,
        },
      ],
      networkLogs: [
        {
          requestId: 'req-init',
          url: initialUrl,
          method: 'GET',
          status: 200,
          statusText: 'OK',
          type: 'Document',
          timestamp: Date.now(),
        },
      ],
    });
  }

  async connect(): Promise<void> {
    const ws = new WebSocket(this.options.wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const readyPromise = new Promise<void>((resolve) => {
      const onMessage = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString()) as { type?: string; sessionId?: string };
        if (msg.type === 'bridge_ready' && msg.sessionId === this.sessionId) {
          ws.off('message', onMessage);
          resolve();
        }
      };
      ws.on('message', onMessage);
    });

    ws.on('message', (raw) => {
      void this.handleRawMessage(raw.toString());
    });

    ws.send(
      JSON.stringify({
        type: 'hello',
        sessionId: this.sessionId,
        profile: this.profile,
        version: this.options.version ?? '2.0.0',
        ...(this.options.token ? { token: this.options.token } : {}),
        timestamp: Date.now(),
      }),
    );

    await readyPromise;
  }

  disconnect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.ws.terminate();
    }
    this.ws = null;
  }

  getActiveTab(): SimulatedTab {
    const active = this.tabs.find((t) => t.active) ?? this.tabs[0];
    if (!active) {
      throw new Error('No simulated tab available');
    }
    return active;
  }

  private resolveTab(tabId?: unknown): SimulatedTab | undefined {
    if (typeof tabId === 'number') {
      return this.tabs.find((t) => t.id === tabId);
    }
    return this.getActiveTab();
  }

  private findElement(
    tab: SimulatedTab,
    params: Record<string, unknown>,
  ): SimulatedElement | undefined {
    if (typeof params.ref === 'string') {
      return tab.elements.find((el) => el.ref === params.ref);
    }
    if (typeof params.selector === 'string') {
      return tab.elements.find((el) => el.selector === params.selector);
    }
    return undefined;
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof msg.id !== 'string' || typeof msg.action !== 'string') {
      return;
    }

    const id = msg.id;
    const action = msg.action;
    const params =
      msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)
        ? (msg.params as Record<string, unknown>)
        : {};

    this.executedCommands.push({ id, action, params });
    const result = this.executeSimulatedCommand(action, params);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id, ...result }));
    }
  }

  private executeSimulatedCommand(
    action: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const tab = this.resolveTab(params.tabId);
    if (!tab) {
      return { success: false, error: `Tab ${String(params.tabId)} not found` };
    }

    switch (action) {
      case 'navigate': {
        const url = typeof params.url === 'string' ? params.url : '';
        if (!url) return { success: false, error: 'Missing parameter: url' };
        tab.url = url;
        tab.title = `${this.profile}: ${new URL(url).hostname}`;
        tab.elements = createElementsForUrl(url, this.profile);
        tab.consoleLogs.push({
          level: 'info',
          text: `[${this.profile}] Navigated to ${url}`,
          timestamp: Date.now(),
          url,
        });
        tab.networkLogs.push({
          requestId: `req-${tab.networkLogs.length + 1}`,
          url,
          method: 'GET',
          status: 200,
          statusText: 'OK',
          type: 'Document',
          timestamp: Date.now(),
        });
        return { success: true, tabId: tab.id, url: tab.url, title: tab.title };
      }

      case 'new_tab': {
        const url = typeof params.url === 'string' && params.url ? params.url : 'about:blank';
        for (const existing of this.tabs) {
          existing.active = false;
        }
        const created: SimulatedTab = {
          id: this.nextTabId++,
          url,
          title: url === 'about:blank' ? 'New Tab' : `${this.profile}: ${url}`,
          active: true,
          inGroup: true,
          elements: createElementsForUrl(url, this.profile),
          consoleLogs: [],
          networkLogs: [],
        };
        this.tabs.push(created);
        return { success: true, tabId: created.id, url: created.url, title: created.title };
      }

      case 'get_url': {
        return { success: true, tabId: tab.id, url: tab.url, title: tab.title };
      }

      case 'get_tabs': {
        const mapped = this.tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          inGroup: t.inGroup,
        }));
        return {
          success: true,
          groupId: this.groupId,
          groupTabs: mapped.filter((t) => t.inGroup),
          allTabs: mapped,
        };
      }

      case 'snapshot': {
        const interactiveOnly = params.interactiveOnly !== false;
        const maxElements =
          typeof params.maxElements === 'number' ? params.maxElements : tab.elements.length;
        const elements = tab.elements
          .filter((el) => (interactiveOnly ? el.visible : true))
          .slice(0, maxElements)
          .map(({ selector: _selector, ...rest }) => rest);

        return {
          success: true,
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          count: elements.length,
          elements,
          ...(params.markOverlay
            ? { overlayRendered: true, image: `data:image/png;base64,${DEFAULT_PNG_BASE64}` }
            : {}),
        };
      }

      case 'type': {
        const target = this.findElement(tab, params);
        const text = typeof params.text === 'string' ? params.text : '';
        if (!target) {
          return { success: false, error: 'Target element not found' };
        }
        target.value = params.clear === false ? `${target.value ?? ''}${text}` : text;
        tab.consoleLogs.push({
          level: 'log',
          text: `[${this.profile}] Typed "${target.value}" into ${target.ref}`,
          timestamp: Date.now(),
          url: tab.url,
        });
        return {
          success: true,
          tabId: tab.id,
          ref: target.ref,
          value: target.value,
        };
      }

      case 'click': {
        const target = this.findElement(tab, params);
        if (!target) {
          return { success: false, error: 'Target element not found' };
        }
        this.submitCount += 1;
        const queryVal = tab.elements.find((e) => e.ref === '@e1')?.value ?? '';
        tab.consoleLogs.push({
          level: 'info',
          text: `[${this.profile}] Clicked ${target.ref} (query="${queryVal}")`,
          timestamp: Date.now(),
          url: tab.url,
        });
        tab.networkLogs.push({
          requestId: `req-${tab.networkLogs.length + 1}`,
          url: `${tab.url.replace(/\/+$/, '')}/submit?q=${encodeURIComponent(queryVal)}`,
          method: 'POST',
          status: 200,
          statusText: 'OK',
          type: 'Fetch',
          timestamp: Date.now(),
        });
        return {
          success: true,
          tabId: tab.id,
          clicked: target.ref,
          submitCount: this.submitCount,
          queryValue: queryVal,
        };
      }

      case 'screenshot': {
        const format = params.format === 'jpeg' ? 'jpeg' : 'png';
        return {
          success: true,
          tabId: tab.id,
          engine: 'cdp',
          image: `data:image/${format};base64,${DEFAULT_PNG_BASE64}`,
        };
      }

      case 'get_text': {
        const queryVal = tab.elements.find((e) => e.ref === '@e1')?.value ?? '';
        return {
          success: true,
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          text: `[${this.profile}] ${tab.title} | query=${queryVal} | submits=${this.submitCount}`,
        };
      }

      case 'get_console_logs': {
        const level = typeof params.level === 'string' ? params.level : 'all';
        const filtered =
          level === 'all' ? tab.consoleLogs : tab.consoleLogs.filter((l) => l.level === level);
        const limit = typeof params.limit === 'number' ? params.limit : filtered.length;
        const logs = filtered.slice(-limit);
        if (params.clear === true) {
          tab.consoleLogs = [];
        }
        return { success: true, tabId: tab.id, count: logs.length, logs };
      }

      case 'get_network_logs': {
        const pattern = typeof params.urlPattern === 'string' ? params.urlPattern : undefined;
        let filtered = tab.networkLogs;
        if (pattern) {
          filtered = filtered.filter((l) => l.url.includes(pattern));
        }
        if (params.errorsOnly === true) {
          filtered = filtered.filter(
            (l) => l.failed || (l.status !== undefined && l.status >= 400),
          );
        }
        const limit = typeof params.limit === 'number' ? params.limit : filtered.length;
        const logs = filtered.slice(-limit);
        if (params.clear === true) {
          tab.networkLogs = [];
        }
        return { success: true, tabId: tab.id, count: logs.length, logs };
      }

      default:
        return { success: true, tabId: tab.id, action, profile: this.profile };
    }
  }
}

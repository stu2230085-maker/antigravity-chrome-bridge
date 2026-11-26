import {
  type BatchResponse,
  type BatchStep,
  type ConsoleLogEntry,
  type ConsoleLogLevel,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  type ExecutionEngine,
  type KeyModifier,
  type NetworkLogEntry,
  type SessionSummary,
  type SnapshotElement,
  type TraceEntry,
} from '@antigravity-bridge/protocol';

export interface AntigravityBridgeClientOptions {
  baseUrl?: string;
  sessionId?: string;
  authToken?: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof globalThis.fetch;
}

export interface CommandCallOptions {
  tabId?: number;
  sessionId?: string;
}

export interface HealthResult {
  status: string;
  timestamp: number;
}

export interface StatusResult {
  connected: boolean;
  pendingCommands: number;
  uptime: number;
  sessionsCount: number;
  sessions: SessionSummary[];
}

export interface SessionsResult {
  sessions: SessionSummary[];
  count: number;
}

export interface TracesResult {
  traces: TraceEntry[];
  count: number;
}

export interface SnapshotResult {
  success: boolean;
  tabId: number;
  url: string;
  title: string;
  count: number;
  elements: SnapshotElement[];
  overlayRendered?: boolean;
  image?: string;
  [key: string]: unknown;
}

export interface ScreenshotResult {
  success: boolean;
  image: string;
  tabId: number;
  engine?: string;
  [key: string]: unknown;
}

export interface TabInfo {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  inGroup?: boolean;
  status?: string;
}

export interface GetTabsResult {
  success: boolean;
  groupTabs: TabInfo[];
  allTabs: TabInfo[];
  groupId: number | null;
  [key: string]: unknown;
}

export interface GetTextResult {
  success: boolean;
  text?: string;
  url?: string;
  title?: string;
  frames?: Array<Record<string, unknown>>;
  count?: number;
  [key: string]: unknown;
}

export interface ConsoleLogsResult {
  success: boolean;
  tabId: number;
  count: number;
  logs: ConsoleLogEntry[];
  [key: string]: unknown;
}

export interface NetworkLogsResult {
  success: boolean;
  tabId: number;
  count: number;
  logs: NetworkLogEntry[];
  [key: string]: unknown;
}

export class BridgeClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BridgeClientError';
  }
}

export function splitTarget(target: string): { ref?: string; selector?: string } {
  if (/^@e\d+$/.test(target.trim())) {
    return { ref: target.trim() };
  }
  return { selector: target };
}

export class AntigravityBridgeClient {
  public readonly baseUrl: string;
  public readonly sessionId?: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: AntigravityBridgeClientOptions = {}) {
    const rawUrl = options.baseUrl ?? `http://${DEFAULT_HOST}:${DEFAULT_HTTP_PORT}`;
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.sessionId = options.sessionId;
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.retries = Math.max(0, options.retries ?? 0);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async requestJson<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {};
        if (init.body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }
        if (this.authToken) {
          headers.Authorization = `Bearer ${this.authToken}`;
        }

        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: init.method,
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        });

        const text = await response.text();
        let data: unknown = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
        }

        if (!response.ok) {
          const errMsg =
            typeof (data as { error?: unknown })?.error === 'string'
              ? (data as { error: string }).error
              : `HTTP ${response.status} ${response.statusText}`;

          if (response.status >= 500 && attempt < this.retries) {
            lastError = new BridgeClientError(errMsg, response.status, data);
            continue;
          }
          throw new BridgeClientError(errMsg, response.status, data);
        }

        return data as T;
      } catch (err) {
        if (err instanceof BridgeClientError && (err.statusCode ?? 0) < 500) {
          throw err;
        }
        lastError = err;
        if (attempt >= this.retries) {
          if (err instanceof BridgeClientError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          throw new BridgeClientError(msg);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new BridgeClientError(String(lastError));
  }

  health(): Promise<HealthResult> {
    return this.requestJson<HealthResult>('/health');
  }

  status(): Promise<StatusResult> {
    return this.requestJson<StatusResult>('/status');
  }

  sessions(): Promise<SessionsResult> {
    return this.requestJson<SessionsResult>('/api/v2/sessions');
  }

  traces(limit?: number): Promise<TracesResult> {
    const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.requestJson<TracesResult>(`/api/v2/traces${query}`);
  }

  async command<T extends Record<string, unknown> = Record<string, unknown>>(
    action: string,
    params: Record<string, unknown> = {},
    opts: { sessionId?: string } = {},
  ): Promise<T> {
    const response = await this.requestJson<{
      success: boolean;
      id: string;
      result: T & { success?: boolean; error?: string };
    }>('/command', {
      method: 'POST',
      body: {
        action,
        params,
        sessionId: opts.sessionId ?? this.sessionId,
      },
    });

    if (response.result && response.result.success === false) {
      throw new BridgeClientError(
        typeof response.result.error === 'string'
          ? response.result.error
          : `Command "${action}" failed`,
        200,
        response.result,
      );
    }

    return response.result;
  }

  batch(
    steps: BatchStep[],
    opts: { stopOnError?: boolean; sessionId?: string } = {},
  ): Promise<BatchResponse> {
    return this.requestJson<BatchResponse>('/api/v2/batch', {
      method: 'POST',
      body: {
        steps,
        stopOnError: opts.stopOnError,
        sessionId: opts.sessionId ?? this.sessionId,
      },
    });
  }

  navigate(url: string, opts: CommandCallOptions = {}): Promise<Record<string, unknown>> {
    return this.command(
      'navigate',
      { url, ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}) },
      { sessionId: opts.sessionId },
    );
  }

  snapshot(
    opts: CommandCallOptions & {
      interactiveOnly?: boolean;
      markOverlay?: boolean;
      maxElements?: number;
    } = {},
  ): Promise<SnapshotResult> {
    const { sessionId, ...params } = opts;
    return this.command<SnapshotResult>('snapshot', params, { sessionId });
  }

  clearMarks(opts: CommandCallOptions = {}): Promise<Record<string, unknown>> {
    return this.command('clear_marks', opts.tabId !== undefined ? { tabId: opts.tabId } : {}, {
      sessionId: opts.sessionId,
    });
  }

  click(
    target: string,
    opts: CommandCallOptions & { engine?: ExecutionEngine; allFrames?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, ...rest } = opts;
    return this.command('click', { ...splitTarget(target), ...rest }, { sessionId });
  }

  type(
    target: string,
    text: string,
    opts: CommandCallOptions & {
      clear?: boolean;
      engine?: ExecutionEngine;
      allFrames?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, ...rest } = opts;
    return this.command('type', { ...splitTarget(target), text, ...rest }, { sessionId });
  }

  pressKey(
    key: string,
    opts: CommandCallOptions & {
      modifiers?: KeyModifier[];
      target?: string;
      selector?: string;
      ref?: string;
      text?: string;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, target, ...rest } = opts;
    return this.command(
      'press_key',
      { key, ...(target ? splitTarget(target) : {}), ...rest },
      { sessionId },
    );
  }

  hover(
    target: string,
    opts: CommandCallOptions & { engine?: ExecutionEngine; allFrames?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, ...rest } = opts;
    return this.command('hover', { ...splitTarget(target), ...rest }, { sessionId });
  }

  select(
    target: string,
    value: string,
    opts: CommandCallOptions & { engine?: ExecutionEngine } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, ...rest } = opts;
    return this.command('select', { ...splitTarget(target), value, ...rest }, { sessionId });
  }

  scroll(
    opts: CommandCallOptions & {
      x?: number;
      y?: number;
      target?: string;
      selector?: string;
      ref?: string;
      direction?: string;
      amount?: number;
      engine?: ExecutionEngine;
      allFrames?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    const { sessionId, target, ...rest } = opts;
    return this.command(
      'scroll',
      { ...(target ? splitTarget(target) : {}), ...rest },
      { sessionId },
    );
  }

  screenshot(
    opts: CommandCallOptions & {
      format?: 'png' | 'jpeg';
      quality?: number;
      fullPage?: boolean;
      target?: string;
      selector?: string;
      ref?: string;
      markOverlay?: boolean;
    } = {},
  ): Promise<ScreenshotResult> {
    const { sessionId, target, ...rest } = opts;
    return this.command<ScreenshotResult>(
      'screenshot',
      { ...(target ? splitTarget(target) : {}), ...rest },
      { sessionId },
    );
  }

  evaluate(code: string, opts: CommandCallOptions = {}): Promise<Record<string, unknown>> {
    return this.command(
      'evaluate',
      { code, ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}) },
      { sessionId: opts.sessionId },
    );
  }

  waitFor(
    selector: string,
    timeout?: number,
    opts: CommandCallOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.command(
      'wait_for',
      {
        selector,
        ...(timeout !== undefined ? { timeout } : {}),
        ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}),
      },
      { sessionId: opts.sessionId },
    );
  }

  getText(
    selector?: string,
    opts: CommandCallOptions & { allFrames?: boolean } = {},
  ): Promise<GetTextResult> {
    const { sessionId, ...rest } = opts;
    return this.command<GetTextResult>(
      'get_text',
      { ...(selector !== undefined ? { selector } : {}), ...rest },
      { sessionId },
    );
  }

  getTabs(opts: { sessionId?: string } = {}): Promise<GetTabsResult> {
    return this.command<GetTabsResult>('get_tabs', {}, { sessionId: opts.sessionId });
  }

  getUrl(opts: CommandCallOptions = {}): Promise<Record<string, unknown>> {
    return this.command('get_url', opts.tabId !== undefined ? { tabId: opts.tabId } : {}, {
      sessionId: opts.sessionId,
    });
  }

  consoleLogs(
    opts: CommandCallOptions & { level?: ConsoleLogLevel; limit?: number; clear?: boolean } = {},
  ): Promise<ConsoleLogsResult> {
    const { sessionId, ...params } = opts;
    return this.command<ConsoleLogsResult>('get_console_logs', params, { sessionId });
  }

  networkLogs(
    opts: CommandCallOptions & {
      urlPattern?: string;
      errorsOnly?: boolean;
      limit?: number;
      clear?: boolean;
    } = {},
  ): Promise<NetworkLogsResult> {
    const { sessionId, ...params } = opts;
    return this.command<NetworkLogsResult>('get_network_logs', params, { sessionId });
  }
}

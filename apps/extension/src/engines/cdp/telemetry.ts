import type { ConsoleLogEntry, NetworkLogEntry } from '@antigravity-bridge/protocol';
import { resolveTab } from '../../background/tab-group.js';
import type { CommandResult } from '../scripting/types.js';
import { debuggerManager } from './debugger-manager.js';

const MAX_LOG_ENTRIES = 200;

interface TabTelemetryBuffer {
  consoleLogs: ConsoleLogEntry[];
  networkLogs: NetworkLogEntry[];
  networkByRequestId: Map<string, NetworkLogEntry>;
}

const tabBuffers = new Map<number, TabTelemetryBuffer>();
let telemetryListenerRegistered = false;

function getOrCreateBuffer(tabId: number): TabTelemetryBuffer {
  let buf = tabBuffers.get(tabId);
  if (!buf) {
    buf = {
      consoleLogs: [],
      networkLogs: [],
      networkByRequestId: new Map(),
    };
    tabBuffers.set(tabId, buf);
  }
  return buf;
}

function pushBounded<T>(arr: T[], entry: T): void {
  if (arr.length >= MAX_LOG_ENTRIES) {
    arr.shift();
  }
  arr.push(entry);
}

function mapConsoleType(type: unknown): ConsoleLogEntry['level'] {
  if (type === 'error' || type === 'assert') return 'error';
  if (type === 'warning' || type === 'warn') return 'warn';
  if (type === 'info' || type === 'debug') return 'info';
  return 'log';
}

function formatRemoteArg(arg: Record<string, unknown>): string {
  if (typeof arg.value === 'string') return arg.value;
  if (arg.value !== undefined) return JSON.stringify(arg.value);
  if (typeof arg.description === 'string') return arg.description;
  if (typeof arg.type === 'string') return `[${arg.type}]`;
  return '';
}

export function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>,
): void {
  const tabId = source.tabId;
  if (tabId === undefined || !params) return;

  const buf = getOrCreateBuffer(tabId);

  if (method === 'Runtime.consoleAPICalled') {
    const args = Array.isArray(params.args) ? (params.args as Array<Record<string, unknown>>) : [];
    const text = args.map(formatRemoteArg).filter(Boolean).join(' ');
    const stackTrace = params.stackTrace as
      | { callFrames?: Array<{ url?: string; lineNumber?: number }> }
      | undefined;
    const topFrame = stackTrace?.callFrames?.[0];

    pushBounded(buf.consoleLogs, {
      level: mapConsoleType(params.type),
      text,
      timestamp: typeof params.timestamp === 'number' ? params.timestamp : Date.now(),
      ...(topFrame?.url ? { url: topFrame.url } : {}),
      ...(typeof topFrame?.lineNumber === 'number' ? { lineNumber: topFrame.lineNumber } : {}),
    });
    return;
  }

  if (method === 'Runtime.exceptionThrown') {
    const details = (params.exceptionDetails ?? {}) as {
      text?: string;
      url?: string;
      lineNumber?: number;
      exception?: { description?: string };
    };
    const text = details.exception?.description || details.text || 'Uncaught exception';
    pushBounded(buf.consoleLogs, {
      level: 'error',
      text,
      timestamp: typeof params.timestamp === 'number' ? params.timestamp : Date.now(),
      ...(details.url ? { url: details.url } : {}),
      ...(typeof details.lineNumber === 'number' ? { lineNumber: details.lineNumber } : {}),
    });
    return;
  }

  if (method === 'Network.requestWillBeSent') {
    const requestId = typeof params.requestId === 'string' ? params.requestId : '';
    const request = (params.request ?? {}) as { url?: string; method?: string };
    if (!requestId || !request.url) return;

    const entry: NetworkLogEntry = {
      requestId,
      url: request.url,
      method: request.method || 'GET',
      type: typeof params.type === 'string' ? params.type : undefined,
      timestamp: typeof params.wallTime === 'number' ? params.wallTime * 1000 : Date.now(),
    };
    if (buf.networkLogs.length >= MAX_LOG_ENTRIES) {
      const removed = buf.networkLogs.shift();
      if (removed) {
        buf.networkByRequestId.delete(removed.requestId);
      }
    }
    buf.networkLogs.push(entry);
    buf.networkByRequestId.set(requestId, entry);
    return;
  }

  if (method === 'Network.responseReceived') {
    const requestId = typeof params.requestId === 'string' ? params.requestId : '';
    const response = (params.response ?? {}) as {
      url?: string;
      status?: number;
      statusText?: string;
    };
    if (!requestId) return;

    const existing = buf.networkByRequestId.get(requestId);
    if (existing) {
      existing.status = response.status;
      existing.statusText = response.statusText;
      if (typeof response.status === 'number' && response.status >= 400) {
        existing.failed = true;
      }
    } else if (response.url) {
      const entry: NetworkLogEntry = {
        requestId,
        url: response.url,
        method: 'GET',
        status: response.status,
        statusText: response.statusText,
        type: typeof params.type === 'string' ? params.type : undefined,
        failed: typeof response.status === 'number' && response.status >= 400 ? true : undefined,
        timestamp: Date.now(),
      };
      pushBounded(buf.networkLogs, entry);
      buf.networkByRequestId.set(requestId, entry);
    }
    return;
  }

  if (method === 'Network.loadingFailed') {
    const requestId = typeof params.requestId === 'string' ? params.requestId : '';
    if (!requestId) return;
    const errorText = typeof params.errorText === 'string' ? params.errorText : 'Loading failed';
    const existing = buf.networkByRequestId.get(requestId);
    if (existing) {
      existing.failed = true;
      existing.errorText = errorText;
    } else {
      const entry: NetworkLogEntry = {
        requestId,
        url: '',
        method: 'GET',
        failed: true,
        errorText,
        timestamp: Date.now(),
      };
      pushBounded(buf.networkLogs, entry);
      buf.networkByRequestId.set(requestId, entry);
    }
  }
}

export function ensureTelemetryListeners(): void {
  if (telemetryListenerRegistered || typeof chrome === 'undefined') return;

  if (chrome.debugger?.onEvent) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      handleDebuggerEvent(
        source,
        method,
        params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined,
      );
    });
  }

  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      tabBuffers.delete(tabId);
    });
  }

  telemetryListenerRegistered = true;
}

export function resetTelemetryForTest(): void {
  tabBuffers.clear();
  telemetryListenerRegistered = false;
}

export async function cmdGetConsoleLogs(params: Record<string, unknown>): Promise<CommandResult> {
  ensureTelemetryListeners();
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await debuggerManager.ensureAttached(tab.id);

  const level = typeof params.level === 'string' ? params.level : 'all';
  const limit =
    typeof params.limit === 'number' && params.limit > 0 ? Math.floor(params.limit) : 100;
  const clear = Boolean(params.clear);

  const buf = getOrCreateBuffer(tab.id);
  let logs = buf.consoleLogs;
  if (level !== 'all') {
    logs = logs.filter((entry) => entry.level === level);
  }
  const sliced = logs.slice(-limit);

  if (clear) {
    buf.consoleLogs = [];
  }

  return {
    success: true,
    tabId: tab.id,
    count: sliced.length,
    logs: sliced,
  };
}

export async function cmdGetNetworkLogs(params: Record<string, unknown>): Promise<CommandResult> {
  ensureTelemetryListeners();
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await debuggerManager.ensureAttached(tab.id);

  const urlPattern = typeof params.urlPattern === 'string' ? params.urlPattern : undefined;
  const errorsOnly = Boolean(params.errorsOnly);
  const limit =
    typeof params.limit === 'number' && params.limit > 0 ? Math.floor(params.limit) : 100;
  const clear = Boolean(params.clear);

  const buf = getOrCreateBuffer(tab.id);
  let logs = buf.networkLogs;
  if (urlPattern) {
    logs = logs.filter((entry) => entry.url.includes(urlPattern));
  }
  if (errorsOnly) {
    logs = logs.filter(
      (entry) => entry.failed === true || (entry.status !== undefined && entry.status >= 400),
    );
  }
  const sliced = logs.slice(-limit);

  if (clear) {
    buf.networkLogs = [];
    buf.networkByRequestId.clear();
  }

  return {
    success: true,
    tabId: tab.id,
    count: sliced.length,
    logs: sliced,
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debuggerManager } from '../engines/cdp/debugger-manager.js';
import { resetTelemetryForTest } from '../engines/cdp/telemetry.js';
import { executeCommand } from '../engines/scripting/index.js';
import { resolveSelector } from '../engines/snapshot/index.js';

type DebuggerEventListener = (
  source: chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>,
) => void;

type DebuggerDetachListener = (source: chrome.debugger.Debuggee, reason: string) => void;

interface MockChromePhase2 {
  tabGroups: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tabs: {
    create: ReturnType<typeof vi.fn>;
    group: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    captureVisibleTab: ReturnType<typeof vi.fn>;
    onUpdated: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onRemoved: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  debugger: {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    onEvent: {
      addListener: ReturnType<typeof vi.fn>;
    };
    onDetach: {
      addListener: ReturnType<typeof vi.fn>;
    };
  };
  emitDebuggerEvent: (tabId: number, method: string, params?: Record<string, unknown>) => void;
  emitDebuggerDetach: (tabId: number, reason?: string) => void;
}

function installMockChrome(): MockChromePhase2 {
  const eventListeners: DebuggerEventListener[] = [];
  const detachListeners: DebuggerDetachListener[] = [];

  const mock: MockChromePhase2 = {
    tabGroups: {
      get: vi.fn(async () => ({ id: 99, title: '🤖 Antigravity' })),
      query: vi.fn(async () => [{ id: 99, title: '🤖 Antigravity' }]),
      update: vi.fn(async () => ({})),
    },
    tabs: {
      create: vi.fn(async () => ({ id: 101, windowId: 1, groupId: 99 })),
      group: vi.fn(async () => 99),
      query: vi.fn(async () => [
        { id: 101, windowId: 1, groupId: 99, url: 'https://example.com', title: 'Example' },
      ]),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        windowId: 1,
        groupId: 99,
        url: 'https://example.com',
        title: 'Example',
      })),
      update: vi.fn(async (tabId: number, props: Record<string, unknown>) => ({
        id: tabId,
        ...props,
      })),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,SOMSHOT'),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      executeScript: vi.fn(async () => [
        { result: { found: true, x: 50, y: 80, tagName: 'BUTTON' } },
      ]),
    },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_target: unknown, method: string) => {
        if (method === 'DOM.getDocument') {
          return { root: { nodeId: 1 } };
        }
        if (method === 'DOM.querySelector') {
          return { nodeId: 42 };
        }
        if (method === 'Page.getLayoutMetrics') {
          return { cssContentSize: { width: 1280, height: 2400 } };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: 'RlVMTFBBR0U=' };
        }
        return {};
      }),
      onEvent: {
        addListener: vi.fn((cb: DebuggerEventListener) => {
          eventListeners.push(cb);
        }),
      },
      onDetach: {
        addListener: vi.fn((cb: DebuggerDetachListener) => {
          detachListeners.push(cb);
        }),
      },
    },
    emitDebuggerEvent(tabId: number, method: string, params?: Record<string, unknown>) {
      for (const cb of eventListeners) {
        cb({ tabId }, method, params);
      }
    },
    emitDebuggerDetach(tabId: number, reason = 'canceled_by_user') {
      for (const cb of detachListeners) {
        cb({ tabId }, reason);
      }
    },
  };

  (globalThis as unknown as { chrome: MockChromePhase2 }).chrome = mock;
  return mock;
}

describe('@antigravity-bridge/extension Phase 2 engines', () => {
  let mockChrome: MockChromePhase2;

  beforeEach(() => {
    debuggerManager.resetForTest();
    resetTelemetryForTest();
    mockChrome = installMockChrome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves @eN refs to [data-agb-ref="@eN"] selectors and runs snapshot + clear_marks', async () => {
    expect(resolveSelector({ selector: '#btn', ref: '@e1' })).toBe('#btn');
    expect(resolveSelector({ ref: '@e1' })).toBe('[data-agb-ref="@e1"]');
    expect(resolveSelector({})).toBeUndefined();

    mockChrome.scripting.executeScript.mockResolvedValueOnce([
      {
        result: {
          url: 'https://example.com',
          title: 'Example',
          overlayRendered: true,
          elements: [
            {
              ref: '@e1',
              role: 'button',
              tagName: 'button',
              label: 'Submit',
              text: 'Submit',
              visible: true,
              rect: { x: 10, y: 20, width: 100, height: 40 },
            },
          ],
        },
      },
    ]);

    const snapRes = await executeCommand({
      action: 'snapshot',
      params: { interactiveOnly: true, markOverlay: true, maxElements: 50 },
    });
    expect(snapRes).toMatchObject({
      success: true,
      count: 1,
      overlayRendered: true,
      image: 'data:image/png;base64,SOMSHOT',
    });

    mockChrome.scripting.executeScript.mockResolvedValueOnce([
      { result: { found: true, tagName: 'BUTTON' } },
    ]);
    const clickRes = await executeCommand({ action: 'click', params: { ref: '@e1' } });
    expect(clickRes.success).toBe(true);
    expect(mockChrome.scripting.executeScript).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: ['[data-agb-ref="@e1"]'],
      }),
    );

    mockChrome.scripting.executeScript.mockResolvedValueOnce([{ result: { removed: true } }]);
    const clearRes = await executeCommand({ action: 'clear_marks', params: {} });
    expect(clearRes).toMatchObject({ success: true, removed: true });
  });

  it('executes CDP press_key, drag_and_drop, upload_file, and fullPage screenshot', async () => {
    const keyRes = await executeCommand({
      action: 'press_key',
      params: { key: 'Enter', modifiers: ['Control', 'Shift'], ref: '@e1' },
    });
    expect(keyRes).toMatchObject({
      success: true,
      key: 'Enter',
      code: 'Enter',
      modifiers: 10,
    });
    expect(mockChrome.debugger.attach).toHaveBeenCalledWith({ tabId: 101 }, '1.3');
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyDown', key: 'Enter', modifiers: 10 }),
    );

    const dragRes = await executeCommand({
      action: 'drag_and_drop',
      params: { sourceX: 10, sourceY: 20, targetX: 200, targetY: 300 },
    });
    expect(dragRes).toMatchObject({
      success: true,
      source: { x: 10, y: 20 },
      target: { x: 200, y: 300 },
    });
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 10, y: 20 }),
    );
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseReleased', x: 200, y: 300 }),
    );

    const uploadRes = await executeCommand({
      action: 'upload_file',
      params: { ref: '@e2', files: ['/tmp/test.png'] },
    });
    expect(uploadRes).toMatchObject({
      success: true,
      nodeId: 42,
      filesCount: 1,
    });
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'DOM.setFileInputFiles',
      { nodeId: 42, files: ['/tmp/test.png'] },
    );

    const fullShot = await executeCommand({
      action: 'screenshot',
      params: { fullPage: true, format: 'png' },
    });
    expect(fullShot).toMatchObject({
      success: true,
      engine: 'cdp',
      image: 'data:image/png;base64,RlVMTFBBR0U=',
    });
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Page.captureScreenshot',
      expect.objectContaining({
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1280, height: 2400, scale: 1 },
      }),
    );

    // Detach event resets attachment tracking
    mockChrome.emitDebuggerDetach(101);
    expect(debuggerManager.isAttached(101)).toBe(false);
  });

  it('captures per-tab CDP console and network logs into bounded ring buffers', async () => {
    // Initialize debugger attachment and event listeners via get_console_logs
    const emptyConsole = await executeCommand({ action: 'get_console_logs', params: {} });
    expect(emptyConsole).toMatchObject({ success: true, count: 0, logs: [] });

    mockChrome.emitDebuggerEvent(101, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ type: 'string', value: 'Boom!' }],
      timestamp: 1000,
    });
    mockChrome.emitDebuggerEvent(101, 'Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'Info message' }],
      timestamp: 1001,
    });
    mockChrome.emitDebuggerEvent(101, 'Runtime.exceptionThrown', {
      timestamp: 1002,
      exceptionDetails: { exception: { description: 'TypeError: x is undefined' } },
    });

    const errLogs = await executeCommand({
      action: 'get_console_logs',
      params: { level: 'error', clear: true },
    });
    expect(errLogs).toMatchObject({
      success: true,
      count: 2,
    });
    expect((errLogs.logs as Array<{ text: string }>).map((l) => l.text)).toEqual([
      'Boom!',
      'TypeError: x is undefined',
    ]);

    const afterClear = await executeCommand({ action: 'get_console_logs', params: {} });
    expect(afterClear).toMatchObject({ success: true, count: 0 });

    mockChrome.emitDebuggerEvent(101, 'Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://api.example.com/v1/ok', method: 'GET' },
      type: 'Fetch',
      wallTime: 1700,
    });
    mockChrome.emitDebuggerEvent(101, 'Network.responseReceived', {
      requestId: 'req-1',
      response: { url: 'https://api.example.com/v1/ok', status: 200, statusText: 'OK' },
    });
    mockChrome.emitDebuggerEvent(101, 'Network.requestWillBeSent', {
      requestId: 'req-2',
      request: { url: 'https://api.example.com/v1/fail', method: 'POST' },
      type: 'XHR',
      wallTime: 1701,
    });
    mockChrome.emitDebuggerEvent(101, 'Network.responseReceived', {
      requestId: 'req-2',
      response: { url: 'https://api.example.com/v1/fail', status: 500, statusText: 'Server Error' },
    });

    const netErrs = await executeCommand({
      action: 'get_network_logs',
      params: { urlPattern: 'api.example.com', errorsOnly: true },
    });
    expect(netErrs).toMatchObject({ success: true, count: 1 });
    expect((netErrs.logs as Array<{ requestId: string; status: number }>)[0]).toMatchObject({
      requestId: 'req-2',
      status: 500,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from '../background/ws-client.js';
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

    // allFrames merges frame snapshots up to maxElements and defaults includeShadowDom to true
    mockChrome.scripting.executeScript.mockResolvedValueOnce([
      {
        result: {
          url: 'https://example.com',
          title: 'Example',
          overlayRendered: false,
          elements: [
            {
              ref: '@e1',
              role: 'button',
              tagName: 'button',
              label: 'TopBtn',
              text: 'TopBtn',
              visible: true,
              rect: { x: 0, y: 0, width: 50, height: 20 },
            },
          ],
        },
      },
      {
        result: {
          url: 'https://frame.example.com',
          title: 'Frame',
          overlayRendered: false,
          elements: [
            {
              ref: '@e1',
              role: 'link',
              tagName: 'a',
              label: 'FrameLink1',
              text: 'FrameLink1',
              visible: true,
              rect: { x: 10, y: 10, width: 60, height: 20 },
            },
            {
              ref: '@e2',
              role: 'link',
              tagName: 'a',
              label: 'FrameLink2',
              text: 'FrameLink2',
              visible: true,
              rect: { x: 10, y: 40, width: 60, height: 20 },
            },
          ],
        },
      },
    ]);
    const multiFrameSnap = await executeCommand({
      action: 'snapshot',
      params: { allFrames: true, maxElements: 2 },
    });
    expect(mockChrome.scripting.executeScript).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { tabId: 101, allFrames: true },
        args: [true, false, 2, true],
      }),
    );
    expect(multiFrameSnap).toMatchObject({
      success: true,
      count: 2,
    });
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

  it('evaluates code via CDP Runtime.evaluate without unsafe-eval and reports exceptions', async () => {
    mockChrome.debugger.sendCommand.mockImplementation(async (_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'number', value: 42 } };
      }
      return {};
    });

    const okRes = await executeCommand({
      action: 'evaluate',
      params: { code: 'return 21 * 2;' },
    });
    expect(okRes).toEqual({ success: true, result: 42 });
    expect(mockChrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Runtime.evaluate',
      {
        expression: '(async () => { return 21 * 2; })()',
        awaitPromise: true,
        returnByValue: true,
      },
    );

    mockChrome.debugger.sendCommand.mockImplementation(async (_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: 'ReferenceError: missingVar is not defined' },
          },
        };
      }
      return {};
    });

    const errRes = await executeCommand({
      action: 'evaluate',
      params: { code: 'return missingVar;' },
    });
    expect(errRes).toEqual({
      success: false,
      error: 'ReferenceError: missingVar is not defined',
    });
  });

  it('falls back from scripting failure to CDP click/type when engine is auto, but not when engine is scripting', async () => {
    // 1. Auto fallback when scripting click returns found: false
    mockChrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { found: false, error: 'Element not found: #btn' } }])
      .mockResolvedValueOnce([{ result: { found: true, x: 120, y: 240, tagName: 'BUTTON' } }]);

    const autoClick = await executeCommand({
      action: 'click',
      params: { selector: '#btn', engine: 'auto' },
    });
    expect(autoClick).toMatchObject({
      success: true,
      engine: 'cdp',
      tabId: 101,
      x: 120,
      y: 240,
    });
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 120, y: 240 }),
    );

    // 2. Auto fallback when scripting type throws (default engine = undefined -> auto)
    mockChrome.scripting.executeScript
      .mockRejectedValueOnce(new Error('Cannot access contents of page'))
      .mockResolvedValueOnce([{ result: { found: true } }]);

    const autoType = await executeCommand({
      action: 'type',
      params: { selector: '#email', text: 'hello' },
    });
    expect(autoType).toMatchObject({
      success: true,
      engine: 'cdp',
      tabId: 101,
      length: 5,
    });
    expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      'Input.insertText',
      { text: 'hello' },
    );

    // 3. Explicit engine: 'scripting' does NOT fallback to CDP
    debuggerManager.resetForTest();
    mockChrome.debugger.attach.mockClear();
    mockChrome.scripting.executeScript.mockResolvedValueOnce([
      { result: { found: false, error: 'Element not found: #only-scripting' } },
    ]);

    const strictScripting = await executeCommand({
      action: 'click',
      params: { selector: '#only-scripting', engine: 'scripting' },
    });
    expect(strictScripting).toEqual({
      success: false,
      error: 'Element not found: #only-scripting',
    });
    expect(mockChrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('auto-detaches idle CDP sessions unless pinned by telemetry commands', async () => {
    vi.useFakeTimers();
    try {
      debuggerManager.setIdleTimeoutMsForTest(500);

      await executeCommand({ action: 'press_key', params: { key: 'Escape' } });
      expect(debuggerManager.isAttached(101)).toBe(true);
      expect(mockChrome.debugger.detach).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(499);
      expect(debuggerManager.isAttached(101)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(debuggerManager.isAttached(101)).toBe(false);
      expect(mockChrome.debugger.detach).toHaveBeenCalledWith({ tabId: 101 });

      // Telemetry commands pin the debugger session so console/network events keep streaming
      mockChrome.debugger.detach.mockClear();
      await executeCommand({ action: 'get_console_logs', params: {} });
      await executeCommand({ action: 'press_key', params: { key: 'Tab' } });
      expect(debuggerManager.isAttached(101)).toBe(true);

      await vi.advanceTimersByTimeAsync(5000);
      expect(debuggerManager.isAttached(101)).toBe(true);
      expect(mockChrome.debugger.detach).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates concurrent WsClient.connect() calls and includes authToken in hello', async () => {
    const sentPayloads: string[] = [];
    const createdSockets: Array<{ onopen: (() => void) | null; close: ReturnType<typeof vi.fn> }> =
      [];

    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readyState = FakeWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((ev: MessageEvent<string>) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn(() => {
        this.readyState = FakeWebSocket.CLOSED;
      });
      send = vi.fn((payload: string) => {
        sentPayloads.push(payload);
      });

      constructor(_url: string) {
        createdSockets.push(this);
      }
    }

    const originalWs = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;

    const chromeWithStorage = mockChrome as unknown as Record<string, unknown>;
    chromeWithStorage.storage = {
      local: {
        get: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            serverUrl: 'ws://127.0.0.1:8767',
            profileName: 'work',
            sessionId: 'ext-session-1',
            authToken: '  my-secret-token  ',
          };
        }),
        set: vi.fn(async () => undefined),
      },
    };
    chromeWithStorage.runtime = {
      getManifest: () => ({ version: '2.0.0' }),
      sendMessage: vi.fn(async () => undefined),
    };

    try {
      const client = new WsClient();
      await Promise.all([client.connect(), client.connect(true)]);

      expect(createdSockets).toHaveLength(1);
      const sock = createdSockets[0];
      expect(sock).toBeDefined();
      if (sock) {
        (sock as unknown as { readyState: number }).readyState = FakeWebSocket.OPEN;
        sock.onopen?.();
      }

      expect(sentPayloads).toHaveLength(1);
      const hello = JSON.parse(sentPayloads[0] ?? '{}') as Record<string, unknown>;
      expect(hello).toMatchObject({
        type: 'hello',
        sessionId: 'ext-session-1',
        profile: 'work',
        version: '2.0.0',
        token: 'my-secret-token',
      });

      client.disconnect();
    } finally {
      globalThis.WebSocket = originalWs;
    }
  });
});

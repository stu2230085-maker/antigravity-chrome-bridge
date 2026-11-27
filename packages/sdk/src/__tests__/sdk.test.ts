import { type BridgeSystem, createBridgeSystem } from '@antigravity-bridge/server';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  AntigravityBridgeClient,
  BridgeClientError,
  formatCompactSnapshot,
  splitTarget,
} from '../index.js';

async function connectMockExtension(wsPort: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

describe('@antigravity-bridge/sdk', () => {
  const systems: BridgeSystem[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    sockets.length = 0;

    while (systems.length > 0) {
      const sys = systems.pop();
      if (sys) await sys.stop();
    }
  });

  it('auto-detects @eN refs vs CSS selectors via splitTarget', () => {
    expect(splitTarget('@e1')).toEqual({ ref: '@e1' });
    expect(splitTarget('@e42')).toEqual({ ref: '@e42' });
    expect(splitTarget('#submit-btn')).toEqual({ selector: '#submit-btn' });
    expect(splitTarget('button.primary')).toEqual({ selector: 'button.primary' });
  });

  it('communicates with createBridgeSystem for health, status, commands, batch, and logs', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const client = new AntigravityBridgeClient({
      baseUrl: `http://127.0.0.1:${httpPort}`,
      timeoutMs: 5000,
    });

    const health = await client.health();
    expect(health.status).toBe('ok');

    const statusBefore = await client.status();
    expect(statusBefore.connected).toBe(false);

    // Expect BridgeClientError 503 when disconnected
    await expect(client.navigate('https://example.com')).rejects.toBeInstanceOf(BridgeClientError);

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);

    const received: Array<{ action: string; params: Record<string, unknown> }> = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        id?: string;
        action?: string;
        params?: Record<string, unknown>;
      };
      if (!msg.id || !msg.action) return;
      received.push({ action: msg.action, params: msg.params ?? {} });

      if (msg.action === 'snapshot') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            tabId: 1,
            url: 'https://example.com',
            title: 'Example',
            count: 1,
            elements: [
              {
                ref: '@e1',
                role: 'button',
                tagName: 'button',
                label: 'Go',
                text: 'Go',
                visible: true,
                rect: { x: 0, y: 0, width: 50, height: 20 },
              },
            ],
          }),
        );
        return;
      }

      if (msg.action === 'screenshot') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            tabId: 1,
            image: 'data:image/png;base64,AAAA',
          }),
        );
        return;
      }

      if (msg.action === 'get_console_logs') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            tabId: 1,
            count: 1,
            logs: [{ level: 'error', text: 'err', timestamp: 123 }],
          }),
        );
        return;
      }

      if (msg.action === 'get_network_logs') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            tabId: 1,
            count: 0,
            logs: [],
          }),
        );
        return;
      }

      if (msg.action === 'get_text') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            text: 'Hello World',
            url: 'https://example.com',
            title: 'Example',
          }),
        );
        return;
      }

      if (msg.action === 'get_tabs') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            groupId: 10,
            groupTabs: [{ id: 1, url: 'https://example.com', title: 'Example', active: true }],
            allTabs: [{ id: 1, url: 'https://example.com', title: 'Example', active: true }],
          }),
        );
        return;
      }

      if (msg.action === 'get_url') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            url: 'https://example.com',
            title: 'Example',
            tabId: 1,
          }),
        );
        return;
      }

      ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
    });

    const sessions = await client.sessions();
    expect(sessions.count).toBe(1);

    await client.navigate('https://example.com');
    const snap = await client.snapshot({
      interactiveOnly: true,
      includeShadowDom: true,
      allFrames: true,
    });
    expect(snap.count).toBe(1);
    expect(snap.elements[0]?.ref).toBe('@e1');
    expect(formatCompactSnapshot(snap)).toContain('[@e1] button "Go"');

    await client.click('@e1', { engine: 'cdp' });
    await client.type('#search', 'vitest', { clear: true });
    await client.pressKey('Enter', { modifiers: ['Control'] });
    await client.hover('@e1');
    await client.select('#country', 'US');
    await client.scroll({ direction: 'down', amount: 200 });
    const shot = await client.screenshot({ fullPage: true });
    expect(shot.image).toBe('data:image/png;base64,AAAA');
    await client.evaluate('return 42');
    await client.waitFor('.ready', 1000);
    await client.clearMarks();
    const textRes = await client.getText('#main');
    expect(textRes.text).toBe('Hello World');
    const tabsRes = await client.getTabs();
    expect(tabsRes.allTabs).toHaveLength(1);
    const urlRes = await client.getUrl();
    expect(urlRes.url).toBe('https://example.com');

    await client.newTab('https://example.com/2');
    await client.switchTab(2);
    await client.goBack({ tabId: 2 });
    await client.goForward({ tabId: 2 });
    await client.reload({ tabId: 2 });
    await client.closeTab({ tabId: 2 });
    await client.uploadFile('@e3', ['/tmp/report.pdf']);
    await client.dragAndDrop({ sourceTarget: '@e1', targetTarget: '#dropzone' });

    const cLogs = await client.consoleLogs({ level: 'error' });
    expect(cLogs.count).toBe(1);
    const nLogs = await client.networkLogs({ errorsOnly: true });
    expect(nLogs.count).toBe(0);

    const batchRes = await client.batch([
      { action: 'get_url' },
      { action: 'click', params: { ref: '@e1' } },
    ]);
    expect(batchRes.success).toBe(true);
    expect(batchRes.completedSteps).toBe(2);

    const traces = await client.traces(5);
    expect(traces.count).toBeGreaterThanOrEqual(5);

    expect(received.find((r) => r.action === 'snapshot')?.params).toMatchObject({
      interactiveOnly: true,
      includeShadowDom: true,
      allFrames: true,
    });
    expect(received.find((r) => r.action === 'click')?.params).toMatchObject({
      ref: '@e1',
      engine: 'cdp',
    });
    expect(received.find((r) => r.action === 'type')?.params).toMatchObject({
      selector: '#search',
      text: 'vitest',
      clear: true,
    });
    expect(received.find((r) => r.action === 'new_tab')?.params).toMatchObject({
      url: 'https://example.com/2',
    });
    expect(received.find((r) => r.action === 'switch_tab')?.params).toMatchObject({
      tabId: 2,
    });
    expect(received.find((r) => r.action === 'go_back')?.params).toMatchObject({ tabId: 2 });
    expect(received.find((r) => r.action === 'go_forward')?.params).toMatchObject({ tabId: 2 });
    expect(received.find((r) => r.action === 'reload')?.params).toMatchObject({ tabId: 2 });
    expect(received.find((r) => r.action === 'close_tab')?.params).toMatchObject({ tabId: 2 });
    expect(received.find((r) => r.action === 'upload_file')?.params).toMatchObject({
      ref: '@e3',
      files: ['/tmp/report.pdf'],
    });
    expect(received.find((r) => r.action === 'drag_and_drop')?.params).toMatchObject({
      sourceRef: '@e1',
      targetSelector: '#dropzone',
    });
  });

  it('supports Saved Workflows API (list, save, run, delete)', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];

    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });

      if (method === 'GET' && url.endsWith('/api/v2/workflows')) {
        return new Response(
          JSON.stringify({
            workflows: [
              {
                id: 'wf-login',
                name: 'Login Flow',
                steps: [{ action: 'navigate', params: { url: 'https://example.com' } }],
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'POST' && url.endsWith('/api/v2/workflows')) {
        return new Response(
          JSON.stringify({
            workflow: {
              id: 'wf-login',
              name: 'Login Flow',
              steps: [{ action: 'navigate', params: { url: 'https://example.com' } }],
              createdAt: 1,
              updatedAt: 2,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'POST' && url.endsWith('/api/v2/workflows/wf-login/run')) {
        return new Response(
          JSON.stringify({
            workflowId: 'wf-login',
            success: true,
            completedSteps: 1,
            totalSteps: 1,
            durationMs: 12,
            results: [{ index: 0, action: 'navigate', success: true, durationMs: 12 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'DELETE' && url.endsWith('/api/v2/workflows/wf-login')) {
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    };

    const client = new AntigravityBridgeClient({
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'default-session',
      fetch: mockFetch,
    });

    const saved = await client.saveWorkflow({
      id: 'wf-login',
      name: 'Login Flow',
      steps: [{ action: 'navigate', params: { url: 'https://example.com' } }],
    });
    expect(saved.workflow.id).toBe('wf-login');

    const listed = await client.listWorkflows();
    expect(listed.workflows).toHaveLength(1);

    const runRes = await client.runWorkflow('wf-login', { stopOnError: true });
    expect(runRes.workflowId).toBe('wf-login');
    expect(runRes.completedSteps).toBe(1);

    const delRes = await client.deleteWorkflow('wf-login');
    expect(delRes.deleted).toBe(true);

    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9999/api/v2/workflows',
        method: 'POST',
        body: {
          id: 'wf-login',
          name: 'Login Flow',
          steps: [{ action: 'navigate', params: { url: 'https://example.com' } }],
        },
      },
      { url: 'http://127.0.0.1:9999/api/v2/workflows', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9999/api/v2/workflows/wf-login/run',
        method: 'POST',
        body: { stopOnError: true, sessionId: 'default-session' },
      },
      {
        url: 'http://127.0.0.1:9999/api/v2/workflows/wf-login',
        method: 'DELETE',
        body: undefined,
      },
    ]);
  });

  it('sends authToken, sessionId, and retries on 5xx responses', async () => {
    let attempts = 0;
    const capturedHeaders: Array<string | null> = [];
    const capturedBodies: string[] = [];

    const mockFetch: typeof globalThis.fetch = async (_input, init) => {
      attempts += 1;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('Authorization'));
      if (typeof init?.body === 'string') {
        capturedBodies.push(init.body);
      }

      if (attempts === 1) {
        return new Response(JSON.stringify({ error: 'Temporary failure' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, id: '1', result: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new AntigravityBridgeClient({
      baseUrl: 'http://127.0.0.1:9999',
      authToken: 'secret-token',
      sessionId: 'work-profile',
      retries: 1,
      fetch: mockFetch,
    });

    await client.click('@e2');
    expect(attempts).toBe(2);
    expect(capturedHeaders).toEqual(['Bearer secret-token', 'Bearer secret-token']);
    expect(JSON.parse(capturedBodies[0] ?? '{}')).toMatchObject({
      action: 'click',
      sessionId: 'work-profile',
      params: { ref: '@e2' },
    });
  });
});

import { type BridgeSystem, createBridgeSystem } from '@antigravity-bridge/server';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AntigravityBridgeClient, BridgeClientError, splitTarget } from '../index.js';

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
    const snap = await client.snapshot({ interactiveOnly: true });
    expect(snap.count).toBe(1);
    expect(snap.elements[0]?.ref).toBe('@e1');

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
    expect(traces.count).toBe(5);

    expect(received.find((r) => r.action === 'click')?.params).toMatchObject({
      ref: '@e1',
      engine: 'cdp',
    });
    expect(received.find((r) => r.action === 'type')?.params).toMatchObject({
      selector: '#search',
      text: 'vitest',
      clear: true,
    });
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

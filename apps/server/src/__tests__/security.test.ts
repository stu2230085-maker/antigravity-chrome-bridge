import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadConfig } from '../config.js';
import { validateCommandPolicy } from '../middleware/security.js';
import { type BridgeSystem, createBridgeSystem } from '../server.js';

async function connectMockExtension(wsPort: number, path = ''): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}${path}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

describe('@antigravity-bridge/server security middleware', () => {
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

  it('parses security env vars in loadConfig', () => {
    const cfg = loadConfig({
      AGB_AUTH_TOKEN: ' top-secret ',
      AGB_ALLOWED_DOMAINS: 'example.com, *.internal.local ',
      AGB_BLOCKED_DOMAINS: 'evil.com, *.bad.org',
      AGB_ALLOW_FILE_URLS: 'true',
      AGB_RATE_LIMIT_PER_MIN: '120',
      AGB_WS_REQUIRE_TOKEN: 'true',
    });

    expect(cfg.authToken).toBe('top-secret');
    expect(cfg.allowedDomains).toEqual(['example.com', '*.internal.local']);
    expect(cfg.blockedDomains).toEqual(['evil.com', '*.bad.org']);
    expect(cfg.allowFileUrls).toBe(true);
    expect(cfg.rateLimitPerMin).toBe(120);
    expect(cfg.wsRequireToken).toBe(true);
  });

  it('enforces Bearer auth on protected endpoints and ?token= on /api/v2/events SSE', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      authToken: 'secret-token-123',
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: string; action?: string };
      if (msg.id && msg.action) {
        ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
      }
    });

    // Public endpoints remain accessible without auth
    expect((await fetch(`http://127.0.0.1:${httpPort}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${httpPort}/`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${httpPort}/docs`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${httpPort}/openapi.json`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${httpPort}/ui/`)).status).toBe(200);

    // Protected endpoints reject missing or wrong Bearer token with 401
    expect((await fetch(`http://127.0.0.1:${httpPort}/status`)).status).toBe(401);
    expect(
      (
        await fetch(`http://127.0.0.1:${httpPort}/status`, {
          headers: { Authorization: 'Bearer wrong-token' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`http://127.0.0.1:${httpPort}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_url' }),
        })
      ).status,
    ).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/api/v2/sessions`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/api/v2/traces`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${httpPort}/api/v2/events`)).status).toBe(401);
    // ?token= only works on /api/v2/events, not /status
    expect((await fetch(`http://127.0.0.1:${httpPort}/status?token=secret-token-123`)).status).toBe(
      401,
    );

    // Valid Bearer token succeeds
    const statusRes = await fetch(`http://127.0.0.1:${httpPort}/status`, {
      headers: { Authorization: 'Bearer secret-token-123' },
    });
    expect(statusRes.status).toBe(200);

    const cmdRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token-123',
      },
      body: JSON.stringify({ action: 'get_url' }),
    });
    expect(cmdRes.status).toBe(200);

    // SSE accepts ?token= query parameter
    const controller = new AbortController();
    const sseRes = await fetch(
      `http://127.0.0.1:${httpPort}/api/v2/events?token=secret-token-123`,
      { signal: controller.signal },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const reader = sseRes.body?.getReader();
    const firstChunk = await reader?.read();
    const text = new TextDecoder().decode(firstChunk?.value);
    expect(text).toContain('event: snapshot');
    await reader?.cancel();
    controller.abort();
  });

  it('enforces domain policy and dangerous URL scheme restrictions across /command, /api/v2/batch, and workflows', async () => {
    expect(
      validateCommandPolicy('navigate', { url: 'file:///etc/passwd' }, { allowFileUrls: false })
        .allowed,
    ).toBe(false);
    expect(
      validateCommandPolicy('navigate', { url: 'file:///tmp/demo.html' }, { allowFileUrls: true })
        .allowed,
    ).toBe(true);

    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      allowedDomains: ['example.com', '*.internal.local'],
      blockedDomains: ['blocked.internal.local'],
      allowFileUrls: false,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);
    const executed: string[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: string; action?: string };
      if (msg.id && msg.action) {
        executed.push(msg.action);
        ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
      }
    });

    // Blocked dangerous schemes -> 403
    for (const url of [
      'chrome://settings',
      'chrome-extension://abcdef/popup.html',
      'javascript:alert(1)',
      'file:///etc/hosts',
    ]) {
      const res = await fetch(`http://127.0.0.1:${httpPort}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'navigate', params: { url } }),
      });
      expect(res.status, `Expected 403 for ${url}`).toBe(403);
    }

    // Blocked domain and non-allowlisted domain -> 403
    const blockedRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'new_tab',
        params: { url: 'https://blocked.internal.local' },
      }),
    });
    expect(blockedRes.status).toBe(403);

    const unlistedRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'navigate', params: { url: 'https://other.org/page' } }),
    });
    expect(unlistedRes.status).toBe(403);

    // Batch containing forbidden URL is rejected with 403 before executing any step
    const batchForbiddenRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [{ action: 'get_url' }, { action: 'navigate', params: { url: 'https://evil.com' } }],
      }),
    });
    expect(batchForbiddenRes.status).toBe(403);
    expect(executed).toEqual([]);

    // Workflow containing forbidden URL is rejected on /run with 403
    const createWfRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Blocked Nav Flow',
        steps: [{ action: 'navigate', params: { url: 'chrome://extensions' } }],
      }),
    });
    expect(createWfRes.status).toBe(201);
    const createdWf = (await createWfRes.json()) as { workflow: { id: string } };
    const runBlockedWfRes = await fetch(
      `http://127.0.0.1:${httpPort}/api/v2/workflows/${createdWf.workflow.id}/run`,
      { method: 'POST' },
    );
    expect(runBlockedWfRes.status).toBe(403);
    expect(executed).toEqual([]);

    // Allowed exact and wildcard subdomain succeed -> 200
    const ok1 = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'navigate', params: { url: 'https://example.com/app' } }),
    });
    expect(ok1.status).toBe(200);

    const ok2 = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [{ action: 'navigate', params: { url: 'https://app.internal.local/home' } }],
      }),
    });
    expect(ok2.status).toBe(200);
    expect(executed).toEqual(['navigate', 'navigate']);
  });

  it('returns 429 Too Many Requests when rateLimitPerMin is exceeded', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      rateLimitPerMin: 3,
      quiet: true,
    });
    systems.push(system);
    const { httpPort } = await system.start();

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${httpPort}/status`);
      expect(res.status).toBe(200);
    }

    const limitedRes = await fetch(`http://127.0.0.1:${httpPort}/status`);
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('retry-after')).toBeTruthy();

    // /health is not rate-limited
    const healthRes = await fetch(`http://127.0.0.1:${httpPort}/health`);
    expect(healthRes.status).toBe(200);
  });

  it('enforces WebSocket token when wsRequireToken is enabled', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      authToken: 'ws-secret',
      wsRequireToken: true,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    // Connection with bad query token gets closed with 4001
    const badWs = new WebSocket(`ws://127.0.0.1:${wsPort}?token=wrong`);
    sockets.push(badWs);
    const badCloseCode = await new Promise<number>((resolve) => {
      badWs.once('close', (code) => resolve(code));
    });
    expect(badCloseCode).toBe(4001);

    // Connection with valid hello token registers session
    const goodWs = await connectMockExtension(wsPort);
    sockets.push(goodWs);
    goodWs.send(
      JSON.stringify({
        type: 'hello',
        sessionId: 'secure-ext',
        profile: 'secure',
        token: 'ws-secret',
      }),
    );

    const ready = await new Promise<Record<string, unknown>>((resolve) => {
      goodWs.once('message', (raw) =>
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>),
      );
    });
    expect(ready.type).toBe('bridge_ready');
    expect(ready.sessionId).toBe('secure-ext');

    const sessionsRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/sessions`, {
      headers: { Authorization: 'Bearer ws-secret' },
    });
    expect(sessionsRes.status).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(sessionsJson.sessions.map((s) => s.sessionId)).toEqual(['secure-ext']);
  });
});

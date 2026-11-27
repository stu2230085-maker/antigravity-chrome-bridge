import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadConfig } from '../config.js';
import { isAllowedOrigin, validateCommandPolicy } from '../middleware/security.js';
import { type BridgeSystem, createBridgeSystem } from '../server.js';

async function connectMockExtension(
  wsPort: number,
  path = '',
  origin?: string,
): Promise<WebSocket> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${wsPort}${path}`,
    origin !== undefined ? { origin } : undefined,
  );
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
      AGB_TRUST_PROXY: 'true',
      AGB_ALLOWED_ORIGINS: ' https://Panel.Corp.Example/ , http://custom.local:3000 ',
    });

    expect(cfg.authToken).toBe('top-secret');
    expect(cfg.allowedDomains).toEqual(['example.com', '*.internal.local']);
    expect(cfg.blockedDomains).toEqual(['evil.com', '*.bad.org']);
    expect(cfg.allowFileUrls).toBe(true);
    expect(cfg.rateLimitPerMin).toBe(120);
    expect(cfg.wsRequireToken).toBe(true);
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.allowedOrigins).toEqual(['https://panel.corp.example', 'http://custom.local:3000']);

    const defaultCfg = loadConfig({});
    expect(defaultCfg.trustProxy).toBe(false);
    expect(defaultCfg.allowedOrigins).toBeUndefined();
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
    expect(
      validateCommandPolicy('navigate', { url: 'data:text/html,<script>alert(1)</script>' }, {})
        .allowed,
    ).toBe(false);
    expect(
      validateCommandPolicy('new_tab', { url: 'blob:https://example.com/1234' }, {}).allowed,
    ).toBe(false);

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
      'data:text/html,<script>alert(1)</script>',
      'blob:https://example.com/1234',
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

  it('ignores X-Forwarded-For in rate limiter unless trustProxy is true', async () => {
    const untrustedSystem = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      rateLimitPerMin: 2,
      quiet: true,
    });
    systems.push(untrustedSystem);
    const { httpPort: untrustedPort } = await untrustedSystem.start();

    expect(
      (
        await fetch(`http://127.0.0.1:${untrustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`http://127.0.0.1:${untrustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.2' },
        })
      ).status,
    ).toBe(200);
    // Spoofed X-Forwarded-For / X-Real-IP does not bypass bucket when trustProxy is false
    expect(
      (
        await fetch(`http://127.0.0.1:${untrustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.3', 'X-Real-IP': '10.0.0.4' },
        })
      ).status,
    ).toBe(429);

    const trustedSystem = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      rateLimitPerMin: 2,
      trustProxy: true,
      quiet: true,
    });
    systems.push(trustedSystem);
    const { httpPort: trustedPort } = await trustedSystem.start();

    expect(
      (
        await fetch(`http://127.0.0.1:${trustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`http://127.0.0.1:${trustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`http://127.0.0.1:${trustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.1' },
        })
      ).status,
    ).toBe(429);
    // Distinct forwarded client IP gets its own bucket when trustProxy is true
    expect(
      (
        await fetch(`http://127.0.0.1:${trustedPort}/status`, {
          headers: { 'X-Forwarded-For': '10.0.0.2' },
        })
      ).status,
    ).toBe(200);
  });

  it('defends against cross-origin HTTP/WS requests and Simple-Request CSRF content types', async () => {
    expect(isAllowedOrigin('chrome-extension://abcdefghijklmnop')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:8766')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:8766')).toBe(true);
    expect(isAllowedOrigin('https://panel.corp.example', ['https://Panel.Corp.Example'])).toBe(
      true,
    );
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://attacker.local')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);

    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      allowedOrigins: ['https://panel.corp.example'],
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    // WebSocket with evil Origin is rejected with 4003 and never registers a session
    const evilWs = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      origin: 'https://evil.example',
    });
    sockets.push(evilWs);
    const evilWsCode = await new Promise<number>((resolve) => {
      evilWs.once('close', (code) => resolve(code));
    });
    expect(evilWsCode).toBe(4003);
    expect(system.sessionManager.listSessions()).toEqual([]);

    // WebSocket with chrome-extension:// and http://127.0.0.1:8766 Origin succeed
    const extWs = await connectMockExtension(wsPort, '', 'chrome-extension://abcdefghijklmnop');
    sockets.push(extWs);
    extWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: string; action?: string };
      if (msg.id && msg.action) {
        extWs.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
      }
    });

    const localWs = await connectMockExtension(wsPort, '', 'http://127.0.0.1:8766');
    sockets.push(localWs);
    expect(system.sessionManager.listSessions()).toHaveLength(2);
    localWs.close();

    // HTTP POST /command with Origin: https://evil.example -> 403
    const evilHttpRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ action: 'get_url' }),
    });
    expect(evilHttpRes.status).toBe(403);
    const evilHttpJson = (await evilHttpRes.json()) as { error: string };
    expect(evilHttpJson.error).toContain('Forbidden origin: https://evil.example');

    // HTTP GET /status with Origin: null -> 403
    const nullOriginRes = await fetch(`http://127.0.0.1:${httpPort}/status`, {
      headers: { Origin: 'null' },
    });
    expect(nullOriginRes.status).toBe(403);

    // Allowed Origins (chrome-extension://, http://127.0.0.1:8766, allowlisted) -> 200
    for (const origin of [
      'chrome-extension://abcdefghijklmnop',
      'http://127.0.0.1:8766',
      'https://panel.corp.example',
    ]) {
      const okOriginRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ action: 'get_url' }),
      });
      expect(okOriginRes.status, `Expected 200 for origin ${origin}`).toBe(200);
    }

    // Simple-Request CSRF Content-Type -> 415
    for (const contentType of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=----csrf',
    ]) {
      const csrfRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify({ action: 'get_url' }),
      });
      expect(csrfRes.status, `Expected 415 for Content-Type ${contentType}`).toBe(415);
    }
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

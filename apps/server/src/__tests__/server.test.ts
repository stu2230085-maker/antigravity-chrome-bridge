import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { type BridgeSystem, createBridgeSystem } from '../server.js';

interface TestClient {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  waitForMessage: (
    predicate: (msg: Record<string, unknown>) => boolean,
  ) => Promise<Record<string, unknown>>;
}

async function connectMockExtension(wsPort: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  const messages: Record<string, unknown>[] = [];
  const waiters: Array<{
    predicate: (msg: Record<string, unknown>) => boolean;
    resolve: (msg: Record<string, unknown>) => void;
  }> = [];

  ws.on('message', (raw) => {
    const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
    messages.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter?.predicate(parsed)) {
        waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const waitForMessage = (
    predicate: (msg: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      waiters.push({ predicate, resolve });
    });
  };

  return { ws, messages, waitForMessage };
}

describe('@antigravity-bridge/server integration', () => {
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
      if (sys) {
        await sys.stop();
      }
    }
  });

  it('serves /health and /status when disconnected and connected', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const healthRes = await fetch(`http://127.0.0.1:${httpPort}/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { status: string; timestamp: number };
    expect(health.status).toBe('ok');
    expect(typeof health.timestamp).toBe('number');

    const statusDisconnected = (await (
      await fetch(`http://127.0.0.1:${httpPort}/status`)
    ).json()) as {
      connected: boolean;
      pendingCommands: number;
      uptime: number;
      sessionsCount: number;
      sessions: unknown[];
    };
    expect(statusDisconnected.connected).toBe(false);
    expect(statusDisconnected.pendingCommands).toBe(0);
    expect(statusDisconnected.sessionsCount).toBe(0);
    expect(statusDisconnected.sessions).toEqual([]);

    // Disconnected POST /command -> 503
    const cmd503 = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_tabs' }),
    });
    expect(cmd503.status).toBe(503);

    // Missing action -> 400
    const cmd400 = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });
    expect(cmd400.status).toBe(400);

    const client = await connectMockExtension(wsPort);
    sockets.push(client.ws);

    const ready = await client.waitForMessage((m) => m.type === 'bridge_ready');
    expect(ready.type).toBe('bridge_ready');

    // Ping / keepalive -> pong
    client.ws.send(JSON.stringify({ type: 'keepalive', timestamp: Date.now() }));
    const pong = await client.waitForMessage((m) => m.type === 'pong');
    expect(pong.type).toBe('pong');

    const statusConnected = (await (await fetch(`http://127.0.0.1:${httpPort}/status`)).json()) as {
      connected: boolean;
      sessionsCount: number;
      sessions: Array<{ sessionId: string; profile: string; active: boolean }>;
    };
    expect(statusConnected.connected).toBe(true);
    expect(statusConnected.sessionsCount).toBe(1);
    expect(statusConnected.sessions[0]?.active).toBe(true);
  });

  it('executes POST /command roundtrip and records traces', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const client = await connectMockExtension(wsPort);
    sockets.push(client.ws);
    await client.waitForMessage((m) => m.type === 'bridge_ready');

    client.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (typeof msg.id === 'string' && msg.action === 'get_url') {
        client.ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            url: 'https://example.com',
            title: 'Example Domain',
            tabId: 7,
          }),
        );
      }
    });

    const res = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_url', params: { tabId: 7 } }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      id: string;
      result: Record<string, unknown>;
    };
    expect(json.success).toBe(true);
    expect(typeof json.id).toBe('string');
    expect(json.result).toMatchObject({
      id: json.id,
      success: true,
      url: 'https://example.com',
      title: 'Example Domain',
      tabId: 7,
    });

    const tracesRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/traces`);
    expect(tracesRes.status).toBe(200);
    const tracesBody = (await tracesRes.json()) as {
      traces: Array<{ id: string; action: string; success: boolean; durationMs: number }>;
      count: number;
    };
    expect(tracesBody.count).toBe(1);
    expect(tracesBody.traces[0]).toMatchObject({
      id: json.id,
      action: 'get_url',
      success: true,
    });
    expect(tracesBody.traces[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns 504 on command timeout and cleans up pending commands on disconnect', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      commandTimeoutMs: 120,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const client1 = await connectMockExtension(wsPort);
    sockets.push(client1.ws);
    await client1.waitForMessage((m) => m.type === 'bridge_ready');

    // Never respond -> 504 timeout
    const timeoutRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_text', params: {} }),
    });
    expect(timeoutRes.status).toBe(504);
    const timeoutBody = (await timeoutRes.json()) as { error: string };
    expect(timeoutBody.error).toContain('timed out');
    expect(system.sessionManager.getPendingCount()).toBe(0);

    // Disconnect while command is in flight
    client1.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (typeof msg.id === 'string' && msg.action === 'reload') {
        client1.ws.close(1000, 'Simulated crash');
      }
    });

    const disconnectRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reload' }),
    });
    expect(disconnectRes.status).toBe(504);
    const disconnectBody = (await disconnectRes.json()) as { error: string };
    expect(disconnectBody.error).toContain('disconnected');
    expect(system.sessionManager.getPendingCount()).toBe(0);
  });

  it('supports multi-session routing via hello handshake and sessionId', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const work = await connectMockExtension(wsPort);
    const personal = await connectMockExtension(wsPort);
    sockets.push(work.ws, personal.ws);

    work.ws.send(
      JSON.stringify({
        type: 'hello',
        sessionId: 'work-session',
        profile: 'work',
        version: '2.0.0',
      }),
    );
    personal.ws.send(
      JSON.stringify({
        type: 'hello',
        sessionId: 'personal-session',
        profile: 'personal',
        version: '2.0.0',
      }),
    );

    await work.waitForMessage((m) => m.type === 'bridge_ready' && m.sessionId === 'work-session');
    await personal.waitForMessage(
      (m) => m.type === 'bridge_ready' && m.sessionId === 'personal-session',
    );

    work.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (typeof msg.id === 'string') {
        work.ws.send(JSON.stringify({ id: msg.id, success: true, from: 'work' }));
      }
    });
    personal.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (typeof msg.id === 'string') {
        personal.ws.send(JSON.stringify({ id: msg.id, success: true, from: 'personal' }));
      }
    });

    const sessionsRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessionsData = (await sessionsRes.json()) as {
      count: number;
      sessions: Array<{ sessionId: string; profile: string }>;
    };
    expect(sessionsData.count).toBe(2);
    expect(sessionsData.sessions.map((s) => s.sessionId).sort()).toEqual([
      'personal-session',
      'work-session',
    ]);

    const workRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_tabs', sessionId: 'work-session' }),
    });
    expect(workRes.status).toBe(200);
    const workJson = (await workRes.json()) as { result: { from: string } };
    expect(workJson.result.from).toBe('work');

    const personalRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_tabs', sessionId: 'personal-session' }),
    });
    expect(personalRes.status).toBe(200);
    const personalJson = (await personalRes.json()) as { result: { from: string } };
    expect(personalJson.result.from).toBe('personal');
  });

  it('rejects unknown actions and invalid command parameters at HTTP boundary with 400', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort } = await system.start();

    // Unknown action returns 400 immediately even without a connected session
    const unknownRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nonexistent_action', params: {} }),
    });
    expect(unknownRes.status).toBe(400);
    const unknownBody = (await unknownRes.json()) as { error: string };
    expect(unknownBody.error).toContain('Unknown command action');

    // Invalid params (click requires selector or ref) returns 400 immediately
    const badClickRes = await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', params: {} }),
    });
    expect(badClickRes.status).toBe(400);
    const badClickBody = (await badClickRes.json()) as { error: string };
    expect(badClickBody.error).toContain('Invalid parameters for "click"');

    // Batch with invalid step returns 400 with stepIndex and action
    const badBatchRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [{ action: 'get_url' }, { action: 'click', params: {} }],
      }),
    });
    expect(badBatchRes.status).toBe(400);
    const badBatchBody = (await badBatchRes.json()) as {
      error: string;
      stepIndex: number;
      action: string;
    };
    expect(badBatchBody.stepIndex).toBe(1);
    expect(badBatchBody.action).toBe('click');

    // Workflow with invalid step returns 400 with stepIndex and action
    const badWfRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Broken Flow',
        steps: [{ action: 'unknown_step' }],
      }),
    });
    expect(badWfRes.status).toBe(400);
    const badWfBody = (await badWfRes.json()) as {
      error: string;
      stepIndex: number;
      action: string;
    };
    expect(badWfBody.stepIndex).toBe(0);
    expect(badWfBody.action).toBe('unknown_step');
  });
});

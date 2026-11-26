import { COMMAND_ACTIONS } from '@antigravity-bridge/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { type BridgeSystem, createBridgeSystem } from '../server.js';

async function connectMockExtension(wsPort: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

describe('@antigravity-bridge/server batch and OpenAPI endpoints', () => {
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

  it('serves GET /openapi.json and GET /docs', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort } = await system.start();

    const specRes = await fetch(`http://127.0.0.1:${httpPort}/openapi.json`);
    expect(specRes.status).toBe(200);
    const spec = (await specRes.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: { CommandAction: { enum: string[] } } };
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/api/v2/batch']).toBeDefined();
    expect(spec.paths['/command']).toBeDefined();
    expect(spec.components.schemas.CommandAction.enum).toEqual([...COMMAND_ACTIONS]);

    const docsRes = await fetch(`http://127.0.0.1:${httpPort}/docs`);
    expect(docsRes.status).toBe(200);
    expect(docsRes.headers.get('content-type')).toContain('text/html');
    const html = await docsRes.text();
    expect(html).toContain('Antigravity Chrome Bridge v2.0 API Reference');
    expect(html).toContain('/api/v2/batch');
    expect(html).toContain('snapshot');
  });

  it('executes POST /api/v2/batch sequentially, records traces, and handles stopOnError', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    // Disconnected -> 503
    const disconnectedRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: [{ action: 'get_url' }] }),
    });
    expect(disconnectedRes.status).toBe(503);

    // Invalid body -> 400
    const badRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: [] }),
    });
    expect(badRes.status).toBe(400);

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);

    const executedOrder: string[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        id?: string;
        action?: string;
        params?: Record<string, unknown>;
      };
      if (!msg.id || !msg.action) return;
      executedOrder.push(msg.action);

      if (msg.action === 'click' && msg.params?.selector === '#fail') {
        ws.send(JSON.stringify({ id: msg.id, success: false, error: 'Element not found' }));
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
    });

    const okRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [
          { action: 'navigate', params: { url: 'https://example.com' }, delayMs: 10 },
          { action: 'snapshot', params: { interactiveOnly: true } },
          { action: 'click', params: { ref: '@e1' } },
        ],
      }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      success: boolean;
      completedSteps: number;
      totalSteps: number;
      durationMs: number;
      results: Array<{ index: number; action: string; success: boolean }>;
    };
    expect(okBody.success).toBe(true);
    expect(okBody.completedSteps).toBe(3);
    expect(okBody.totalSteps).toBe(3);
    expect(okBody.results.map((r) => r.action)).toEqual(['navigate', 'snapshot', 'click']);
    expect(executedOrder).toEqual(['navigate', 'snapshot', 'click']);

    // Stop on error stops at step 2
    executedOrder.length = 0;
    const stopRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stopOnError: true,
        steps: [
          { action: 'get_url' },
          { action: 'click', params: { selector: '#fail' } },
          { action: 'get_text' },
        ],
      }),
    });
    expect(stopRes.status).toBe(200);
    const stopBody = (await stopRes.json()) as {
      success: boolean;
      completedSteps: number;
      totalSteps: number;
      results: Array<{ index: number; success: boolean; error?: string }>;
    };
    expect(stopBody.success).toBe(false);
    expect(stopBody.completedSteps).toBe(1);
    expect(stopBody.totalSteps).toBe(3);
    expect(stopBody.results).toHaveLength(2);
    expect(stopBody.results[1]?.error).toBe('Element not found');
    expect(executedOrder).toEqual(['get_url', 'click']);

    // Continue when stopOnError is false
    executedOrder.length = 0;
    const contRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stopOnError: false,
        steps: [{ action: 'click', params: { selector: '#fail' } }, { action: 'get_url' }],
      }),
    });
    const contBody = (await contRes.json()) as {
      success: boolean;
      completedSteps: number;
      totalSteps: number;
      results: Array<{ success: boolean }>;
    };
    expect(contBody.success).toBe(false);
    expect(contBody.completedSteps).toBe(1);
    expect(contBody.results).toHaveLength(2);
    expect(executedOrder).toEqual(['click', 'get_url']);

    // Traces recorded for all 7 executed commands
    const tracesRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/traces`);
    const tracesJson = (await tracesRes.json()) as { count: number };
    expect(tracesJson.count).toBe(7);
  });
});

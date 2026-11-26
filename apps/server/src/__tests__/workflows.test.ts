import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('@antigravity-bridge/server saved workflows & SSE events', () => {
  const systems: BridgeSystem[] = [];
  const sockets: WebSocket[] = [];
  const tempDirs: string[] = [];

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

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports workflow CRUD, JSON persistence, and running a saved workflow', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agb-workflows-'));
    tempDirs.push(tempDir);
    const workflowsFile = join(tempDir, 'workflows.json');

    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      workflowsFile,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    // Initially empty
    const listEmptyRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`);
    expect(listEmptyRes.status).toBe(200);
    expect(await listEmptyRes.json()).toEqual({ workflows: [] });

    // Invalid payload -> 400
    const badRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', steps: [] }),
    });
    expect(badRes.status).toBe(400);

    // Create -> 201
    const createRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Smoke Flow',
        description: 'Open example and click',
        steps: [
          { action: 'navigate', params: { url: 'https://example.com' } },
          { action: 'snapshot', params: { interactiveOnly: true } },
          { action: 'click', params: { ref: '@e1' } },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const createdJson = (await createRes.json()) as {
      workflow: { id: string; name: string; description?: string; steps: unknown[] };
    };
    expect(createdJson.workflow.name).toBe('Smoke Flow');
    expect(createdJson.workflow.steps).toHaveLength(3);
    const workflowId = createdJson.workflow.id;

    // Update -> 200
    const updateRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: workflowId,
        name: 'Smoke Flow v2',
        steps: [
          { action: 'navigate', params: { url: 'https://example.com' } },
          { action: 'get_url' },
        ],
      }),
    });
    expect(updateRes.status).toBe(200);
    const updatedJson = (await updateRes.json()) as {
      workflow: { id: string; name: string; steps: unknown[] };
    };
    expect(updatedJson.workflow.id).toBe(workflowId);
    expect(updatedJson.workflow.name).toBe('Smoke Flow v2');
    expect(updatedJson.workflow.steps).toHaveLength(2);

    // Persisted across restart
    await system.stop();
    const restarted = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      workflowsFile,
      quiet: true,
    });
    systems.push(restarted);
    const restartedPorts = await restarted.start();

    const listRestarted = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows`,
    );
    expect(listRestarted.status).toBe(200);
    const listed = (await listRestarted.json()) as {
      workflows: Array<{ id: string; name: string }>;
    };
    expect(listed.workflows).toHaveLength(1);
    expect(listed.workflows[0]?.name).toBe('Smoke Flow v2');

    // Run missing workflow -> 404
    const missingRun = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows/does-not-exist/run`,
      { method: 'POST' },
    );
    expect(missingRun.status).toBe(404);

    // Run without connected session -> 503
    const disconnectedRun = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows/${workflowId}/run`,
      { method: 'POST' },
    );
    expect(disconnectedRun.status).toBe(503);

    // Connect mock extension and run workflow
    const ws = await connectMockExtension(restartedPorts.wsPort);
    sockets.push(ws);

    const executed: string[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: string; action?: string };
      if (!msg.id || !msg.action) return;
      executed.push(msg.action);
      ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
    });

    const runRes = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows/${workflowId}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopOnError: true }),
      },
    );
    expect(runRes.status).toBe(200);
    const runJson = (await runRes.json()) as {
      workflowId: string;
      success: boolean;
      completedSteps: number;
      totalSteps: number;
      durationMs: number;
      results: Array<{ action: string; success: boolean }>;
    };
    expect(runJson.workflowId).toBe(workflowId);
    expect(runJson.success).toBe(true);
    expect(runJson.completedSteps).toBe(2);
    expect(runJson.totalSteps).toBe(2);
    expect(runJson.durationMs).toBeGreaterThanOrEqual(0);
    expect(executed).toEqual(['navigate', 'get_url']);

    // Delete -> 200, second delete -> 404
    const delRes = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows/${workflowId}`,
      { method: 'DELETE' },
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ deleted: true });

    const delMissing = await fetch(
      `http://127.0.0.1:${restartedPorts.httpPort}/api/v2/workflows/${workflowId}`,
      { method: 'DELETE' },
    );
    expect(delMissing.status).toBe(404);
    expect(wsPort).toBeGreaterThan(0);
  });

  it('streams snapshot, sessions, and trace events over GET /api/v2/events and updates OpenAPI', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const specRes = await fetch(`http://127.0.0.1:${httpPort}/openapi.json`);
    const spec = (await specRes.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/api/v2/workflows']).toBeDefined();
    expect(spec.paths['/api/v2/workflows/{id}']).toBeDefined();
    expect(spec.paths['/api/v2/workflows/{id}/run']).toBeDefined();
    expect(spec.paths['/api/v2/events']).toBeDefined();

    const controller = new AbortController();
    const sseRes = await fetch(`http://127.0.0.1:${httpPort}/api/v2/events`, {
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');

    const reader = sseRes.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let buffer = '';

    const readUntil = async (needle: string): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for "${needle}" in SSE buffer:\n${buffer}`);
        }
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil('event: snapshot');

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: string; action?: string };
      if (!msg.id || !msg.action) return;
      ws.send(JSON.stringify({ id: msg.id, success: true }));
    });

    await readUntil('event: sessions');

    await fetch(`http://127.0.0.1:${httpPort}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_url' }),
    });

    await readUntil('event: trace');
    expect(buffer).toContain('"action":"get_url"');

    await reader?.cancel();
    controller.abort();

    const cleanupDeadline = Date.now() + 1000;
    while (system.eventBus.subscriberCount > 0 && Date.now() < cleanupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(system.eventBus.subscriberCount).toBe(0);
  });

  it('serves the Web Control Center under GET /ui/ and root info under GET /', async () => {
    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      quiet: true,
    });
    systems.push(system);
    const { httpPort } = await system.start();

    const rootRes = await fetch(`http://127.0.0.1:${httpPort}/`);
    expect(rootRes.status).toBe(200);
    const rootJson = (await rootRes.json()) as { dashboard: string; docs: string };
    expect(rootJson.dashboard).toBe('/ui');
    expect(rootJson.docs).toBe('/docs');

    const uiRedirectRes = await fetch(`http://127.0.0.1:${httpPort}/ui`, {
      redirect: 'manual',
    });
    expect(uiRedirectRes.status).toBe(302);
    expect(uiRedirectRes.headers.get('location')).toBe('/ui/');

    const uiRes = await fetch(`http://127.0.0.1:${httpPort}/ui/`);
    expect(uiRes.status).toBe(200);
    expect(uiRes.headers.get('content-type')).toContain('text/html');
    const html = await uiRes.text();
    expect(html).toContain('Antigravity');

    const cssMatch = html.match(/href="\.\/(assets\/[^"]+\.css)"/);
    expect(cssMatch?.[1]).toBeTruthy();
    const cssRes = await fetch(`http://127.0.0.1:${httpPort}/ui/${cssMatch?.[1]}`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    const jsMatch = html.match(/src="\.\/(assets\/[^"]+\.js)"/);
    expect(jsMatch?.[1]).toBeTruthy();
    const jsRes = await fetch(`http://127.0.0.1:${httpPort}/ui/${jsMatch?.[1]}`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('application/javascript');
  });
});

import { AntigravityBridgeClient } from '@antigravity-bridge/sdk';
import { type BridgeSystem, createBridgeSystem } from '@antigravity-bridge/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMcpBridgeServer } from '../index.js';

async function connectMockExtension(wsPort: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

describe('@antigravity-bridge/mcp', () => {
  const systems: BridgeSystem[] = [];
  const sockets: WebSocket[] = [];
  const closables: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (closables.length > 0) {
      const c = closables.pop();
      if (c) await c.close();
    }

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

  it('registers all 25 browser tools and executes them over InMemoryTransport', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);

    const actions: Array<{ action: string; params: Record<string, unknown> }> = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        id?: string;
        action?: string;
        params?: Record<string, unknown>;
      };
      if (!msg.id || !msg.action) return;
      actions.push({ action: msg.action, params: msg.params ?? {} });

      if (msg.action === 'snapshot') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            tabId: 1,
            url: 'https://example.com',
            title: 'Example',
            count: 1,
            ...(msg.params?.markOverlay ? { image: 'data:image/png;base64,b3ZlcmxheQ==' } : {}),
            elements: [
              {
                ref: '@e1',
                role: 'button',
                tagName: 'button',
                label: 'Go',
                text: 'Go',
                visible: true,
                rect: { x: 0, y: 0, width: 40, height: 20 },
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
            engine: 'cdp',
            image: 'data:image/jpeg;base64,ZmFrZUJhc2U2NA==',
          }),
        );
        return;
      }

      if (msg.action === 'evaluate') {
        ws.send(JSON.stringify({ id: msg.id, success: true, result: 'ok-eval' }));
        return;
      }

      if (msg.action === 'get_text') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            text: 'Visible Text Content',
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
            groupId: 1,
            groupTabs: [],
            allTabs: [{ id: 1, url: 'https://example.com', title: 'Example', active: true }],
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
            logs: [{ level: 'warn', text: 'Watch out', timestamp: 100 }],
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
            count: 1,
            logs: [
              { requestId: 'req1', url: 'https://example.com/api', method: 'POST', status: 201 },
            ],
          }),
        );
        return;
      }

      ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
    });

    const fallbackWorkflows = new Map<
      string,
      {
        id: string;
        name: string;
        steps: Array<{ action: string; params?: Record<string, unknown> }>;
        createdAt: number;
        updatedAt: number;
      }
    >();

    const bridgeFetch: typeof globalThis.fetch = async (input, init) => {
      const res = await globalThis.fetch(input, init);
      if (res.status !== 404) {
        return res;
      }
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/api/v2/workflows')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          id?: string;
          name: string;
          steps: Array<{ action: string; params?: Record<string, unknown> }>;
        };
        const wf = {
          id: body.id ?? 'wf-1',
          name: body.name,
          steps: body.steps,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fallbackWorkflows.set(wf.id, wf);
        return new Response(JSON.stringify({ workflow: wf }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.endsWith('/api/v2/workflows')) {
        return new Response(JSON.stringify({ workflows: [...fallbackWorkflows.values()] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const runMatch = /\/api\/v2\/workflows\/([^/]+)\/run$/.exec(url);
      if (method === 'POST' && runMatch?.[1]) {
        const wfId = decodeURIComponent(runMatch[1]);
        const wf = fallbackWorkflows.get(wfId);
        if (wf) {
          const runOpts = JSON.parse(String(init?.body ?? '{}')) as {
            stopOnError?: boolean;
            sessionId?: string;
          };
          const batchRes = await globalThis.fetch(`http://127.0.0.1:${httpPort}/api/v2/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              steps: wf.steps,
              stopOnError: runOpts.stopOnError,
              sessionId: runOpts.sessionId,
            }),
          });
          const batchData = (await batchRes.json()) as Record<string, unknown>;
          return new Response(JSON.stringify({ workflowId: wfId, ...batchData }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return res;
    };

    const bridgeClient = new AntigravityBridgeClient({
      baseUrl: `http://127.0.0.1:${httpPort}`,
      fetch: bridgeFetch,
    });
    await bridgeClient.saveWorkflow({
      id: 'wf-demo',
      name: 'Demo Workflow',
      steps: [{ action: 'get_url' }],
    });

    const mcpServer = createMcpBridgeServer(bridgeClient);
    const mcpClient = new Client({ name: 'vitest-mcp-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
    closables.push(mcpClient, mcpServer);

    const listed = await mcpClient.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toHaveLength(25);
    expect(names).toEqual([
      'browser_batch',
      'browser_click',
      'browser_close_tab',
      'browser_console_logs',
      'browser_drag_and_drop',
      'browser_evaluate',
      'browser_get_text',
      'browser_go_back',
      'browser_hover',
      'browser_navigate',
      'browser_network_logs',
      'browser_new_tab',
      'browser_press_key',
      'browser_reload',
      'browser_screenshot',
      'browser_scroll',
      'browser_select',
      'browser_snapshot',
      'browser_status',
      'browser_switch_tab',
      'browser_tabs',
      'browser_type',
      'browser_upload_file',
      'browser_wait_for',
      'browser_workflows',
    ]);

    const statusCall = await mcpClient.callTool({ name: 'browser_status', arguments: {} });
    expect(statusCall.isError).not.toBe(true);
    const statusJson = JSON.parse(
      (statusCall.content[0] as { type: 'text'; text: string }).text,
    ) as { connected: boolean };
    expect(statusJson.connected).toBe(true);

    await mcpClient.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    const snapCall = await mcpClient.callTool({
      name: 'browser_snapshot',
      arguments: { interactiveOnly: true },
    });
    const snapJson = JSON.parse((snapCall.content[0] as { type: 'text'; text: string }).text) as {
      count: number;
    };
    expect(snapJson.count).toBe(1);

    const compactSnapCall = await mcpClient.callTool({
      name: 'browser_snapshot',
      arguments: {
        format: 'compact',
        markOverlay: true,
        includeShadowDom: true,
        allFrames: true,
      },
    });
    expect(compactSnapCall.content).toHaveLength(2);
    expect((compactSnapCall.content[0] as { type: 'text'; text: string }).text).toContain(
      'Page: Example (https://example.com)',
    );
    expect((compactSnapCall.content[0] as { type: 'text'; text: string }).text).toContain(
      '[@e1] button "Go"',
    );
    expect(compactSnapCall.content[1]).toEqual({
      type: 'image',
      data: 'b3ZlcmxheQ==',
      mimeType: 'image/png',
    });

    await mcpClient.callTool({
      name: 'browser_click',
      arguments: { target: '@e1', engine: 'cdp' },
    });
    await mcpClient.callTool({
      name: 'browser_type',
      arguments: { target: '#q', text: 'mcp', clear: true },
    });
    await mcpClient.callTool({
      name: 'browser_press_key',
      arguments: { key: 'Enter', modifiers: ['Control'] },
    });
    await mcpClient.callTool({
      name: 'browser_scroll',
      arguments: { direction: 'down', amount: 150 },
    });
    await mcpClient.callTool({
      name: 'browser_wait_for',
      arguments: { selector: '.ready', timeout: 1500 },
    });
    await mcpClient.callTool({
      name: 'browser_select',
      arguments: { target: '#country', value: 'CA', engine: 'scripting' },
    });
    await mcpClient.callTool({
      name: 'browser_hover',
      arguments: { target: '@e1', allFrames: true },
    });

    const getTextCall = await mcpClient.callTool({
      name: 'browser_get_text',
      arguments: { selector: '#main', allFrames: false },
    });
    expect((getTextCall.content[0] as { text: string }).text).toContain('Visible Text Content');

    await mcpClient.callTool({
      name: 'browser_upload_file',
      arguments: { target: '@e2', files: ['/tmp/doc.txt'] },
    });
    await mcpClient.callTool({
      name: 'browser_drag_and_drop',
      arguments: { sourceTarget: '@e1', targetTarget: '#drop' },
    });
    await mcpClient.callTool({
      name: 'browser_new_tab',
      arguments: { url: 'https://example.com/tab2' },
    });
    await mcpClient.callTool({
      name: 'browser_switch_tab',
      arguments: { tabId: 2 },
    });
    await mcpClient.callTool({
      name: 'browser_reload',
      arguments: { tabId: 2 },
    });
    await mcpClient.callTool({
      name: 'browser_go_back',
      arguments: { tabId: 2 },
    });
    await mcpClient.callTool({
      name: 'browser_close_tab',
      arguments: { tabId: 2 },
    });

    const shotCall = await mcpClient.callTool({
      name: 'browser_screenshot',
      arguments: { format: 'jpeg', fullPage: true },
    });
    expect(shotCall.content[0]).toEqual({
      type: 'image',
      data: 'ZmFrZUJhc2U2NA==',
      mimeType: 'image/jpeg',
    });

    const evalCall = await mcpClient.callTool({
      name: 'browser_evaluate',
      arguments: { code: 'return "ok-eval"' },
    });
    expect((evalCall.content[0] as { text: string }).text).toContain('ok-eval');

    const tabsCall = await mcpClient.callTool({ name: 'browser_tabs', arguments: {} });
    expect((tabsCall.content[0] as { text: string }).text).toContain('https://example.com');

    const cLogsCall = await mcpClient.callTool({
      name: 'browser_console_logs',
      arguments: { level: 'warn' },
    });
    expect((cLogsCall.content[0] as { text: string }).text).toContain('Watch out');

    const nLogsCall = await mcpClient.callTool({
      name: 'browser_network_logs',
      arguments: { limit: 10 },
    });
    expect((nLogsCall.content[0] as { text: string }).text).toContain('https://example.com/api');

    const batchCall = await mcpClient.callTool({
      name: 'browser_batch',
      arguments: { steps: [{ action: 'get_url' }, { action: 'click', params: { ref: '@e1' } }] },
    });
    const batchJson = JSON.parse((batchCall.content[0] as { type: 'text'; text: string }).text) as {
      completedSteps: number;
    };
    expect(batchJson.completedSteps).toBe(2);

    const wfListCall = await mcpClient.callTool({
      name: 'browser_workflows',
      arguments: { action: 'list' },
    });
    expect(wfListCall.isError).not.toBe(true);
    expect((wfListCall.content[0] as { text: string }).text).toContain('wf-demo');

    const wfRunCall = await mcpClient.callTool({
      name: 'browser_workflows',
      arguments: { action: 'run', workflowId: 'wf-demo', stopOnError: true },
    });
    expect(wfRunCall.isError).not.toBe(true);
    const wfRunJson = JSON.parse((wfRunCall.content[0] as { text: string }).text) as {
      workflowId: string;
      completedSteps: number;
    };
    expect(wfRunJson.workflowId).toBe('wf-demo');
    expect(wfRunJson.completedSteps).toBe(1);

    const wfErrCall = await mcpClient.callTool({
      name: 'browser_workflows',
      arguments: { action: 'run' },
    });
    expect(wfErrCall.isError).toBe(true);

    expect(actions.find((a) => a.action === 'click')?.params).toMatchObject({
      ref: '@e1',
      engine: 'cdp',
    });
    expect(actions.find((a) => a.action === 'wait_for')?.params).toMatchObject({
      selector: '.ready',
      timeout: 1500,
    });
    expect(actions.find((a) => a.action === 'select')?.params).toMatchObject({
      selector: '#country',
      value: 'CA',
      engine: 'scripting',
    });
    expect(actions.find((a) => a.action === 'hover')?.params).toMatchObject({
      ref: '@e1',
      allFrames: true,
    });
    expect(actions.find((a) => a.action === 'upload_file')?.params).toMatchObject({
      ref: '@e2',
      files: ['/tmp/doc.txt'],
    });
    expect(actions.find((a) => a.action === 'drag_and_drop')?.params).toMatchObject({
      sourceRef: '@e1',
      targetSelector: '#drop',
    });
    expect(actions.find((a) => a.action === 'new_tab')?.params).toMatchObject({
      url: 'https://example.com/tab2',
    });
    expect(actions.find((a) => a.action === 'switch_tab')?.params).toMatchObject({ tabId: 2 });
    expect(actions.find((a) => a.action === 'reload')?.params).toMatchObject({ tabId: 2 });
    expect(actions.find((a) => a.action === 'go_back')?.params).toMatchObject({ tabId: 2 });
    expect(actions.find((a) => a.action === 'close_tab')?.params).toMatchObject({ tabId: 2 });
  });

  it('returns isError=true when bridge command fails', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort } = await system.start();

    const bridgeClient = new AntigravityBridgeClient({
      baseUrl: `http://127.0.0.1:${httpPort}`,
    });
    const mcpServer = createMcpBridgeServer(bridgeClient);
    const mcpClient = new Client({ name: 'vitest-mcp-err', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
    closables.push(mcpClient, mcpServer);

    const res = await mcpClient.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('not connected');
  });
});

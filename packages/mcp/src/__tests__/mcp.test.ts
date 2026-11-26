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

  it('registers all 13 browser tools and executes them over InMemoryTransport', async () => {
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

    const bridgeClient = new AntigravityBridgeClient({
      baseUrl: `http://127.0.0.1:${httpPort}`,
    });
    const mcpServer = createMcpBridgeServer(bridgeClient);
    const mcpClient = new Client({ name: 'vitest-mcp-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
    closables.push(mcpClient, mcpServer);

    const listed = await mcpClient.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'browser_batch',
      'browser_click',
      'browser_console_logs',
      'browser_evaluate',
      'browser_navigate',
      'browser_network_logs',
      'browser_press_key',
      'browser_screenshot',
      'browser_scroll',
      'browser_snapshot',
      'browser_status',
      'browser_tabs',
      'browser_type',
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

    expect(actions.find((a) => a.action === 'click')?.params).toMatchObject({
      ref: '@e1',
      engine: 'cdp',
    });
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

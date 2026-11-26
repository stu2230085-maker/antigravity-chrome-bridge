import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '@antigravity-bridge/cli';
import { createMcpBridgeServer } from '@antigravity-bridge/mcp';
import { AntigravityBridgeClient, BridgeClientError } from '@antigravity-bridge/sdk';
import { type BridgeSystem, createBridgeSystem } from '@antigravity-bridge/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MockExtensionAgent } from '../mock-extension-agent.js';

const AUTH_TOKEN = 'e2e-bridge-secret-token';

function createMemoryCliIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, Uint8Array | string>();

  return {
    stdout,
    stderr,
    files,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      readFile: async (path: string) => {
        const val = files.get(path);
        if (typeof val === 'string') return val;
        if (val instanceof Uint8Array) return Buffer.from(val).toString('utf8');
        throw new Error(`ENOENT: ${path}`);
      },
      writeFile: async (path: string, data: Uint8Array) => {
        files.set(path, data);
      },
      env: {},
    },
  };
}

describe('Antigravity Chrome Bridge v2 Full-Stack E2E', () => {
  const systems: BridgeSystem[] = [];
  const agents: MockExtensionAgent[] = [];
  const closables: Array<{ close: () => Promise<void> }> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (closables.length > 0) {
      const item = closables.pop();
      if (item) await item.close();
    }

    while (agents.length > 0) {
      const agent = agents.pop();
      agent?.disconnect();
    }

    while (systems.length > 0) {
      const sys = systems.pop();
      if (sys) await sys.stop();
    }

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function bootSecuredBridge() {
    const tempDir = mkdtempSync(join(tmpdir(), 'agb-e2e-'));
    tempDirs.push(tempDir);

    const system = createBridgeSystem({
      host: '127.0.0.1',
      httpPort: 0,
      wsPort: 0,
      authToken: AUTH_TOKEN,
      wsRequireToken: true,
      allowedDomains: ['example.com', '*.internal.local'],
      blockedDomains: ['blocked.internal.local'],
      allowFileUrls: false,
      workflowsFile: join(tempDir, 'workflows.json'),
      quiet: true,
    });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();
    return {
      system,
      httpPort,
      wsPort,
      baseUrl: `http://127.0.0.1:${httpPort}`,
      wsUrl: `ws://127.0.0.1:${wsPort}`,
    };
  }

  it('isolates multi-profile Chrome sessions (work vs personal) via SDK', async () => {
    const { baseUrl, wsUrl } = await bootSecuredBridge();

    const workAgent = new MockExtensionAgent({
      wsUrl,
      sessionId: 'sess-work',
      profile: 'work',
      token: AUTH_TOKEN,
    });
    const personalAgent = new MockExtensionAgent({
      wsUrl,
      sessionId: 'sess-personal',
      profile: 'personal',
      token: AUTH_TOKEN,
    });
    agents.push(workAgent, personalAgent);
    await Promise.all([workAgent.connect(), personalAgent.connect()]);

    // Unauthenticated client is rejected with 401
    const unauthClient = new AntigravityBridgeClient({ baseUrl });
    await expect(unauthClient.status()).rejects.toMatchObject({ statusCode: 401 });

    const workClient = new AntigravityBridgeClient({
      baseUrl,
      authToken: AUTH_TOKEN,
      sessionId: 'sess-work',
    });
    const personalClient = new AntigravityBridgeClient({
      baseUrl,
      authToken: AUTH_TOKEN,
      sessionId: 'sess-personal',
    });

    const sessions = await workClient.sessions();
    expect(sessions.count).toBe(2);
    expect(sessions.sessions.map((s) => s.profile).sort()).toEqual(['personal', 'work']);

    await workClient.navigate('https://app.internal.local/dashboard');
    await personalClient.navigate('https://example.com/blog');

    await workClient.type('@e1', 'quarterly report');
    await personalClient.type('@e1', 'weekend recipes');

    const workUrl = await workClient.getUrl();
    const personalUrl = await personalClient.getUrl();
    expect(workUrl.url).toBe('https://app.internal.local/dashboard');
    expect(personalUrl.url).toBe('https://example.com/blog');

    const workText = await workClient.getText();
    const personalText = await personalClient.getText();
    expect(workText.text).toContain('[work]');
    expect(workText.text).toContain('query=quarterly report');
    expect(personalText.text).toContain('[personal]');
    expect(personalText.text).toContain('query=weekend recipes');

    expect(workAgent.executedCommands.some((c) => c.action === 'navigate')).toBe(true);
    expect(personalAgent.executedCommands.some((c) => c.action === 'navigate')).toBe(true);
  });

  it('executes full CLI workflow (nav -> snap -> type @e1 -> click @e2 -> logs) with --token', async () => {
    const { baseUrl, wsUrl } = await bootSecuredBridge();

    const agent = new MockExtensionAgent({
      wsUrl,
      sessionId: 'sess-cli',
      profile: 'cli-profile',
      token: AUTH_TOKEN,
    });
    agents.push(agent);
    await agent.connect();

    // Missing --token fails with exit code 1
    {
      const mem = createMemoryCliIo();
      const code = await runCli(['--url', baseUrl, 'status'], mem.io);
      expect(code).toBe(1);
      expect(mem.stderr.join('\n')).toContain('Unauthorized');
    }

    // nav
    {
      const mem = createMemoryCliIo();
      const code = await runCli(
        ['--url', baseUrl, '--token', AUTH_TOKEN, 'nav', 'https://example.com/search'],
        mem.io,
      );
      expect(code).toBe(0);
      expect(mem.stdout[0]).toContain('https://example.com/search');
    }

    // snap
    {
      const mem = createMemoryCliIo();
      const code = await runCli(['--url', baseUrl, '--token', AUTH_TOKEN, 'snap'], mem.io);
      expect(code).toBe(0);
      const output = mem.stdout.join('\n');
      expect(output).toContain('@e1 [textbox]');
      expect(output).toContain('@e2 [button] "Submit Search"');
    }

    // type @e1
    {
      const mem = createMemoryCliIo();
      const code = await runCli(
        ['--url', baseUrl, '--token', AUTH_TOKEN, 'type', '@e1', 'antigravity'],
        mem.io,
      );
      expect(code).toBe(0);
      expect(mem.stdout[0]).toContain('Typed into @e1');
    }

    // click @e2
    {
      const mem = createMemoryCliIo();
      const code = await runCli(['--url', baseUrl, '--token', AUTH_TOKEN, 'click', '@e2'], mem.io);
      expect(code).toBe(0);
      expect(mem.stdout[0]).toContain('Clicked @e2');
    }

    // logs (console + network)
    {
      const mem = createMemoryCliIo();
      const code = await runCli(['--url', baseUrl, '--token', AUTH_TOKEN, 'logs'], mem.io);
      expect(code).toBe(0);
      const consoleOut = mem.stdout.join('\n');
      expect(consoleOut).toContain('Typed "antigravity" into @e1');
      expect(consoleOut).toContain('Clicked @e2 (query="antigravity")');
    }

    {
      const mem = createMemoryCliIo();
      const code = await runCli(
        ['--url', baseUrl, '--token', AUTH_TOKEN, 'logs', '--network'],
        mem.io,
      );
      expect(code).toBe(0);
      expect(mem.stdout.join('\n')).toContain(
        'POST https://example.com/search/submit?q=antigravity',
      );
    }
  });

  it('executes MCP tools (navigate, snapshot, click, screenshot with base64 image block) over InMemoryTransport', async () => {
    const { baseUrl, wsUrl } = await bootSecuredBridge();

    const agent = new MockExtensionAgent({
      wsUrl,
      sessionId: 'sess-mcp',
      profile: 'mcp-profile',
      token: AUTH_TOKEN,
    });
    agents.push(agent);
    await agent.connect();

    const sdkClient = new AntigravityBridgeClient({
      baseUrl,
      authToken: AUTH_TOKEN,
    });
    const mcpServer = createMcpBridgeServer(sdkClient);
    const mcpClient = new Client({ name: 'e2e-mcp-client', version: '2.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
    closables.push(mcpClient, mcpServer);

    type McpContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string };

    const getContent = (res: unknown): McpContentBlock[] => {
      const content =
        typeof res === 'object' && res !== null && 'content' in res
          ? (res as { content?: unknown }).content
          : undefined;
      expect(Array.isArray(content)).toBe(true);
      return content as McpContentBlock[];
    };

    const navRes = await mcpClient.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://portal.internal.local/app' },
    });
    expect(navRes.isError).not.toBe(true);
    const navFirst = getContent(navRes)[0];
    expect(navFirst?.type === 'text' ? navFirst.text : '').toContain(
      'https://portal.internal.local/app',
    );

    const snapRes = await mcpClient.callTool({
      name: 'browser_snapshot',
      arguments: { interactiveOnly: true },
    });
    expect(snapRes.isError).not.toBe(true);
    const snapFirst = getContent(snapRes)[0];
    const snapJson = JSON.parse(snapFirst?.type === 'text' ? snapFirst.text : '{}') as {
      count: number;
      elements: Array<{ ref: string }>;
    };
    expect(snapJson.count).toBe(2);
    expect(snapJson.elements.map((e) => e.ref)).toEqual(['@e1', '@e2']);

    const clickRes = await mcpClient.callTool({
      name: 'browser_click',
      arguments: { target: '@e2', engine: 'cdp' },
    });
    expect(clickRes.isError).not.toBe(true);
    const clickFirst = getContent(clickRes)[0];
    expect(clickFirst?.type === 'text' ? clickFirst.text : '').toContain('"clicked": "@e2"');

    const shotRes = await mcpClient.callTool({
      name: 'browser_screenshot',
      arguments: { format: 'png', fullPage: false },
    });
    expect(shotRes.isError).not.toBe(true);
    const imageBlock = getContent(shotRes).find(
      (c): c is { type: 'image'; data: string; mimeType: string } => c.type === 'image',
    );
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.mimeType).toBe('image/png');
    expect(imageBlock?.data).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(imageBlock?.data ?? '', 'base64').byteLength).toBeGreaterThan(0);
  });

  it('supports saved workflow creation, execution, SSE real-time trace streaming, and 403 domain policy enforcement', async () => {
    const { system, baseUrl, wsUrl } = await bootSecuredBridge();

    const agent = new MockExtensionAgent({
      wsUrl,
      sessionId: 'sess-wf',
      profile: 'workflow-profile',
      token: AUTH_TOKEN,
    });
    agents.push(agent);
    await agent.connect();

    // Connect authenticated SSE stream via ?token=
    const sseController = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/v2/events?token=${encodeURIComponent(AUTH_TOKEN)}`, {
      signal: sseController.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const readUntil = async (needle: string): Promise<void> => {
      const deadline = Date.now() + 4000;
      while (!sseBuffer.includes(needle)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for "${needle}" in SSE stream:\n${sseBuffer}`);
        }
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        sseBuffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil('event: snapshot');

    // Create a saved workflow
    const createRes = await fetch(`${baseUrl}/api/v2/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        name: 'E2E Checkout Flow',
        description: 'Navigate, snapshot, type, click',
        steps: [
          { action: 'navigate', params: { url: 'https://shop.internal.local/cart' } },
          { action: 'snapshot', params: { interactiveOnly: true } },
          { action: 'type', params: { ref: '@e1', text: 'PROMO20' } },
          { action: 'click', params: { ref: '@e2' } },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { workflow: { id: string } };

    // Execute the saved workflow
    const runRes = await fetch(`${baseUrl}/api/v2/workflows/${created.workflow.id}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({ sessionId: 'sess-wf', stopOnError: true }),
    });
    expect(runRes.status).toBe(200);
    const runBody = (await runRes.json()) as {
      workflowId: string;
      success: boolean;
      completedSteps: number;
      totalSteps: number;
    };
    expect(runBody.workflowId).toBe(created.workflow.id);
    expect(runBody.success).toBe(true);
    expect(runBody.completedSteps).toBe(4);
    expect(runBody.totalSteps).toBe(4);

    // Verify SSE trace events arrived in real time
    await readUntil('event: trace');
    await readUntil('"action":"navigate"');
    await readUntil('"action":"click"');

    // Verify domain policy 403 enforcement via SDK and HTTP
    const sdkClient = new AntigravityBridgeClient({
      baseUrl,
      authToken: AUTH_TOKEN,
      sessionId: 'sess-wf',
    });

    await expect(sdkClient.navigate('https://blocked.internal.local/admin')).rejects.toSatisfy(
      (err: unknown) => err instanceof BridgeClientError && err.statusCode === 403,
    );
    await expect(sdkClient.navigate('chrome://settings')).rejects.toSatisfy(
      (err: unknown) => err instanceof BridgeClientError && err.statusCode === 403,
    );
    await expect(sdkClient.navigate('https://unlisted.example.org')).rejects.toSatisfy(
      (err: unknown) => err instanceof BridgeClientError && err.statusCode === 403,
    );

    const blockedBatchRes = await fetch(`${baseUrl}/api/v2/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        steps: [{ action: 'new_tab', params: { url: 'file:///etc/passwd' } }],
      }),
    });
    expect(blockedBatchRes.status).toBe(403);

    await reader?.cancel();
    sseController.abort();
    const cleanupDeadline = Date.now() + 1000;
    while (system.eventBus.subscriberCount > 0 && Date.now() < cleanupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(system.eventBus.subscriberCount).toBe(0);
  });
});

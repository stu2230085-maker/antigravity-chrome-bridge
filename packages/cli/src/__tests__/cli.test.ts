import { type BridgeSystem, createBridgeSystem } from '@antigravity-bridge/server';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { formatSnapshotElement, runCli } from '../index.js';

async function connectMockExtension(wsPort: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function createMemoryIo() {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, Uint8Array | string>();

  return {
    out,
    err,
    files,
    io: {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
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

describe('@antigravity-bridge/cli', () => {
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

  it('prints help and formats snapshot elements cleanly', async () => {
    const { out, err, io } = createMemoryIo();
    const code = await runCli(['--help'], io);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out.join('\n')).toContain('agb — Antigravity Chrome Bridge CLI');
    expect(out.join('\n')).toContain('--compact');
    expect(out.join('\n')).toContain('wait <selector> [--timeout <ms>]');

    expect(
      formatSnapshotElement({
        ref: '@e1',
        role: 'button',
        tagName: 'button',
        label: 'Submit',
        text: 'Submit',
        visible: true,
        rect: { x: 0, y: 0, width: 80, height: 32 },
      }),
    ).toBe('@e1 [button] "Submit"');
  });

  it('executes subcommands against createBridgeSystem in human and --json modes', async () => {
    const system = createBridgeSystem({ host: '127.0.0.1', httpPort: 0, wsPort: 0, quiet: true });
    systems.push(system);
    const { httpPort, wsPort } = await system.start();
    const baseUrl = `http://127.0.0.1:${httpPort}`;

    const ws = await connectMockExtension(wsPort);
    sockets.push(ws);

    const commandsSeen: Array<{ action: string; params: Record<string, unknown> }> = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        id?: string;
        action?: string;
        params?: Record<string, unknown>;
      };
      if (!msg.id || !msg.action) return;
      commandsSeen.push({ action: msg.action, params: msg.params ?? {} });

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
                label: 'Submit',
                text: 'Submit',
                visible: true,
                rect: { x: 10, y: 20, width: 100, height: 30 },
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
            image: `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`,
          }),
        );
        return;
      }

      if (msg.action === 'evaluate') {
        ws.send(JSON.stringify({ id: msg.id, success: true, result: { answer: 42 } }));
        return;
      }

      if (msg.action === 'get_text') {
        ws.send(JSON.stringify({ id: msg.id, success: true, text: 'Page Body Text' }));
        return;
      }

      if (msg.action === 'get_tabs') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            groupId: 5,
            groupTabs: [],
            allTabs: [
              { id: 1, title: 'Example', url: 'https://example.com', active: true, inGroup: true },
            ],
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
            logs: [{ level: 'error', text: 'Boom', timestamp: 1 }],
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
            logs: [{ requestId: '1', method: 'GET', url: 'https://api.example.com', status: 500 }],
          }),
        );
        return;
      }

      ws.send(JSON.stringify({ id: msg.id, success: true, action: msg.action }));
    });

    // status
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'status'], mem.io)).toBe(0);
      expect(mem.out.join('\n')).toContain('Connected: yes');
    }

    // sessions --json
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, '--json', 'sessions'], mem.io)).toBe(0);
      const parsed = JSON.parse(mem.out.join('\n')) as { count: number };
      expect(parsed.count).toBe(1);
    }

    // nav
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'nav', 'https://example.com'], mem.io)).toBe(0);
      expect(mem.out[0]).toContain('https://example.com');
    }

    // snap
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'snap', '--all', '--overlay'], mem.io)).toBe(0);
      expect(mem.out.join('\n')).toContain('@e1 [button] "Submit"');
      const snapCmd = commandsSeen.find((c) => c.action === 'snapshot');
      expect(snapCmd?.params).toMatchObject({ interactiveOnly: false, markOverlay: true });
    }

    // snap --compact
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'snap', '--compact'], mem.io)).toBe(0);
      expect(mem.out.join('\n')).toContain('Page: Example (https://example.com)');
      expect(mem.out.join('\n')).toContain('[@e1] button "Submit" @(10,20 100x30)');
    }

    // click --cdp & type --append & key & wait
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'click', '@e1', '--cdp'], mem.io)).toBe(0);
      expect(await runCli(['--url', baseUrl, 'type', '#input', 'hello', '--append'], mem.io)).toBe(
        0,
      );
      expect(await runCli(['--url', baseUrl, 'key', 'Enter'], mem.io)).toBe(0);
      expect(await runCli(['--url', baseUrl, 'wait', '.loaded', '--timeout', '2000'], mem.io)).toBe(
        0,
      );
      expect(mem.out.join('\n')).toContain('Matched .loaded');
      expect(commandsSeen.find((c) => c.action === 'click')?.params).toMatchObject({
        ref: '@e1',
        engine: 'cdp',
      });
      expect(commandsSeen.find((c) => c.action === 'type')?.params).toMatchObject({
        selector: '#input',
        text: 'hello',
        clear: false,
      });
      expect(commandsSeen.find((c) => c.action === 'press_key')?.params).toMatchObject({
        key: 'Enter',
      });
      expect(commandsSeen.find((c) => c.action === 'wait_for')?.params).toMatchObject({
        selector: '.loaded',
        timeout: 2000,
      });
    }

    // shot to file
    {
      const mem = createMemoryIo();
      expect(
        await runCli(['--url', baseUrl, 'shot', 'out.png', '--full', '--target', '@e1'], mem.io),
      ).toBe(0);
      const written = mem.files.get('out.png');
      expect(written).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(written as Uint8Array).toString('utf8')).toBe('PNGDATA');
    }

    // eval, text, tabs, logs (console + network), traces
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'eval', '1+1'], mem.io)).toBe(0);
      expect(mem.out.join('\n')).toContain('"answer": 42');
    }
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'text', '#main'], mem.io)).toBe(0);
      expect(mem.out[0]).toBe('Page Body Text');
    }
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'tabs'], mem.io)).toBe(0);
      expect(mem.out[0]).toContain('#1 Example [group]');
    }
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'logs', '--errors', '--clear'], mem.io)).toBe(0);
      expect(mem.out[0]).toBe('[error] Boom');
    }
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'logs', '--network', '--errors'], mem.io)).toBe(0);
      expect(mem.out[0]).toBe('[500] GET https://api.example.com');
    }
    {
      const mem = createMemoryIo();
      mem.files.set(
        'flow.json',
        JSON.stringify({
          steps: [{ action: 'get_url' }, { action: 'click', params: { ref: '@e1' } }],
        }),
      );
      expect(await runCli(['--url', baseUrl, 'batch', 'flow.json'], mem.io)).toBe(0);
      expect(mem.out[0]).toContain('Batch completed: 2/2 steps');
    }
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'traces', '--limit', '5'], mem.io)).toBe(0);
      expect(mem.out.join('\n')).toContain('[OK]');
    }

    // unknown command returns 1
    {
      const mem = createMemoryIo();
      expect(await runCli(['--url', baseUrl, 'nope'], mem.io)).toBe(1);
      expect(mem.err.join('\n')).toContain('Unknown command');
    }
  });
});

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  type BatchStep,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  formatCompactSnapshot,
  type SnapshotElement,
} from '@antigravity-bridge/protocol';
import { AntigravityBridgeClient, BridgeClientError } from '@antigravity-bridge/sdk';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  env: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

const HELP_TEXT = `agb — Antigravity Chrome Bridge CLI v2.0

Usage:
  agb [global options] <command> [args] [command options]

Global Options:
  -u, --url <httpUrl>     Bridge HTTP URL (default: http://${DEFAULT_HOST}:${DEFAULT_HTTP_PORT})
  -s, --session <id>      Target extension session ID
  -t, --token <token>     Bearer auth token
  -j, --json              Print raw JSON output
  -h, --help              Show help

Commands:
  status                              Show bridge connection status
  sessions                            List connected extension sessions
  traces [--limit <n>]                Show recent command traces
  nav <url>                           Navigate active tab to URL
  snap [--all] [--overlay] [--compact]
                                      Capture AI DOM snapshot (@eN refs)
  click <target> [--cdp]              Click @eN ref or CSS selector
  type <target> <text> [--append]     Type text into @eN ref or CSS selector
  key <key>                           Press keyboard key via CDP
  wait <selector> [--timeout <ms>]    Wait for CSS selector to appear
  shot [outFile] [--full] [--target]  Capture screenshot (PNG/JPEG data URL or file)
  eval <code>                         Evaluate JavaScript in active tab
  text [selector]                     Get visible text of page or element
  url                                 Get active tab URL
  tabs                                List browser tabs
  logs [--network] [--errors] [--clear]
                                      Get console or network logs
  batch <jsonFile>                    Execute batch steps JSON file`;

export function printHelp(): string {
  return HELP_TEXT;
}

export function formatSnapshotElement(el: SnapshotElement): string {
  const rawText = (el.label || el.text || el.placeholder || el.href || '').trim();
  const displayText = rawText.replace(/\s+/g, ' ').slice(0, 80);
  const quoted = displayText ? ` "${displayText}"` : '';
  const extra = el.value !== undefined && el.value !== '' ? ` (value="${el.value}")` : '';
  return `${el.ref} [${el.role}]${quoted}${extra}`;
}

function decodeBase64DataUrl(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function parseBatchFileContent(raw: string): { steps: BatchStep[]; stopOnError?: boolean } {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return { steps: parsed as BatchStep[] };
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { steps?: unknown }).steps)
  ) {
    const obj = parsed as { steps: BatchStep[]; stopOnError?: boolean };
    return { steps: obj.steps, stopOnError: obj.stopOnError };
  }
  throw new Error('Batch file must contain a JSON array of steps or an object with "steps"');
}

export async function runCli(argv: string[], ioOverrides: Partial<CliIo> = {}): Promise<number> {
  const io: CliIo = {
    stdout: ioOverrides.stdout ?? ((line) => console.log(line)),
    stderr: ioOverrides.stderr ?? ((line) => console.error(line)),
    readFile: ioOverrides.readFile ?? ((filePath) => readFile(filePath, 'utf8')),
    writeFile: ioOverrides.writeFile ?? ((filePath, data) => writeFile(filePath, data)),
    env: ioOverrides.env ?? process.env,
    fetch: ioOverrides.fetch,
  };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        url: { type: 'string', short: 'u' },
        session: { type: 'string', short: 's' },
        token: { type: 'string', short: 't' },
        json: { type: 'boolean', short: 'j', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        all: { type: 'boolean', short: 'a', default: false },
        overlay: { type: 'boolean', short: 'o', default: false },
        compact: { type: 'boolean', default: false },
        cdp: { type: 'boolean', default: false },
        append: { type: 'boolean', default: false },
        full: { type: 'boolean', default: false },
        target: { type: 'string' },
        timeout: { type: 'string' },
        network: { type: 'boolean', default: false },
        errors: { type: 'boolean', default: false },
        clear: { type: 'boolean', default: false },
        limit: { type: 'string' },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`Error: ${message}`);
    return 1;
  }

  const values = parsed.values as {
    url?: string;
    session?: string;
    token?: string;
    json: boolean;
    help: boolean;
    all: boolean;
    overlay: boolean;
    compact: boolean;
    cdp: boolean;
    append: boolean;
    full: boolean;
    target?: string;
    timeout?: string;
    network: boolean;
    errors: boolean;
    clear: boolean;
    limit?: string;
  };
  const positionals = parsed.positionals;

  if (values.help || positionals.length === 0 || positionals[0] === 'help') {
    io.stdout(HELP_TEXT);
    return 0;
  }

  const command = positionals[0] ?? '';
  const args = positionals.slice(1);

  const client = new AntigravityBridgeClient({
    baseUrl: values.url ?? io.env.AGB_URL ?? `http://${DEFAULT_HOST}:${DEFAULT_HTTP_PORT}`,
    sessionId: values.session ?? io.env.AGB_SESSION,
    authToken: values.token ?? io.env.AGB_TOKEN,
    fetch: io.fetch,
  });

  const emitJson = (payload: unknown): void => {
    io.stdout(JSON.stringify(payload, null, 2));
  };

  try {
    switch (command) {
      case 'status': {
        const res = await client.status();
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Connected: ${res.connected ? 'yes' : 'no'}`);
          io.stdout(`Sessions: ${res.sessionsCount}`);
          io.stdout(`Pending commands: ${res.pendingCommands}`);
          io.stdout(`Uptime: ${res.uptime.toFixed(1)}s`);
          for (const s of res.sessions) {
            io.stdout(`  - ${s.sessionId} [${s.profile}] active=${s.active}`);
          }
        }
        return 0;
      }

      case 'sessions': {
        const res = await client.sessions();
        if (values.json) {
          emitJson(res);
        } else if (res.sessions.length === 0) {
          io.stdout('No connected sessions.');
        } else {
          for (const s of res.sessions) {
            io.stdout(`${s.sessionId} [${s.profile}] active=${s.active}`);
          }
        }
        return 0;
      }

      case 'traces': {
        const limit = values.limit ? Number(values.limit) : undefined;
        const res = await client.traces(Number.isFinite(limit) ? limit : undefined);
        if (values.json) {
          emitJson(res);
        } else if (res.traces.length === 0) {
          io.stdout('No traces recorded.');
        } else {
          for (const t of res.traces) {
            const status = t.success ? 'OK' : 'ERR';
            const errSuffix = t.error ? ` — ${t.error}` : '';
            io.stdout(
              `[${status}] ${t.action} (${t.durationMs}ms) session=${t.sessionId}${errSuffix}`,
            );
          }
        }
        return 0;
      }

      case 'nav': {
        const url = args[0];
        if (!url) {
          io.stderr('Usage: agb nav <url>');
          return 1;
        }
        const res = await client.navigate(url);
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Navigated to ${url}`);
        }
        return 0;
      }

      case 'snap': {
        const res = await client.snapshot({
          interactiveOnly: !values.all,
          markOverlay: values.overlay,
        });
        if (values.json) {
          emitJson(res);
        } else if (values.compact) {
          io.stdout(
            formatCompactSnapshot({
              url: res.url,
              title: res.title,
              elements: res.elements ?? [],
            }),
          );
        } else {
          io.stdout(`${res.title || '(untitled)'} — ${res.url} (${res.count} elements)`);
          for (const el of res.elements) {
            io.stdout(formatSnapshotElement(el));
          }
        }
        return 0;
      }

      case 'click': {
        const target = args[0];
        if (!target) {
          io.stderr('Usage: agb click <target> [--cdp]');
          return 1;
        }
        const res = await client.click(target, values.cdp ? { engine: 'cdp' } : {});
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Clicked ${target}`);
        }
        return 0;
      }

      case 'type': {
        const target = args[0];
        const text = args[1];
        if (!target || text === undefined) {
          io.stderr('Usage: agb type <target> <text> [--append]');
          return 1;
        }
        const res = await client.type(target, text, {
          clear: !values.append,
          ...(values.cdp ? { engine: 'cdp' } : {}),
        });
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Typed into ${target}`);
        }
        return 0;
      }

      case 'key': {
        const key = args[0];
        if (!key) {
          io.stderr('Usage: agb key <key>');
          return 1;
        }
        const res = await client.pressKey(key, values.target ? { target: values.target } : {});
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Pressed ${key}`);
        }
        return 0;
      }

      case 'wait': {
        const selector = args[0];
        if (!selector) {
          io.stderr('Usage: agb wait <selector> [--timeout <ms>]');
          return 1;
        }
        let timeoutMs: number | undefined;
        if (values.timeout !== undefined) {
          const parsedTimeout = Number(values.timeout);
          if (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
            io.stderr('Error: --timeout must be a positive integer (milliseconds)');
            return 1;
          }
          timeoutMs = parsedTimeout;
        }
        const res = await client.waitFor(selector, timeoutMs);
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(`Matched ${selector}`);
        }
        return 0;
      }

      case 'shot': {
        const outFile = args[0];
        const res = await client.screenshot({
          fullPage: values.full,
          ...(values.target ? { target: values.target } : {}),
        });
        if (outFile && typeof res.image === 'string') {
          const bytes = decodeBase64DataUrl(res.image);
          await io.writeFile(outFile, bytes);
          if (values.json) {
            emitJson({ ...res, savedTo: outFile, bytes: bytes.byteLength });
          } else {
            io.stdout(`Saved screenshot to ${outFile} (${bytes.byteLength} bytes)`);
          }
        } else if (values.json) {
          emitJson(res);
        } else {
          const size = typeof res.image === 'string' ? res.image.length : 0;
          io.stdout(`Captured screenshot (tab ${res.tabId}, ${size} chars)`);
        }
        return 0;
      }

      case 'eval': {
        const code = args.join(' ');
        if (!code) {
          io.stderr('Usage: agb eval <code>');
          return 1;
        }
        const res = await client.evaluate(code);
        if (values.json) {
          emitJson(res);
        } else {
          const val = res.result;
          io.stdout(typeof val === 'string' ? val : (JSON.stringify(val, null, 2) ?? 'undefined'));
        }
        return 0;
      }

      case 'text': {
        const selector = args[0];
        const res = await client.getText(selector);
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(res.text ?? '');
        }
        return 0;
      }

      case 'url': {
        const res = await client.getUrl();
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(String(res.url ?? ''));
        }
        return 0;
      }

      case 'tabs': {
        const res = await client.getTabs();
        if (values.json) {
          emitJson(res);
        } else if (res.allTabs.length === 0) {
          io.stdout('No tabs found.');
        } else {
          for (const t of res.allTabs) {
            const marker = t.active ? '*' : ' ';
            const groupTag = t.inGroup ? ' [group]' : '';
            io.stdout(
              `[${marker}] #${t.id ?? '?'} ${t.title ?? '(untitled)'}${groupTag} — ${t.url ?? ''}`,
            );
          }
        }
        return 0;
      }

      case 'logs': {
        const limit = values.limit ? Number(values.limit) : undefined;
        const parsedLimit = Number.isFinite(limit) ? limit : undefined;

        if (values.network) {
          const res = await client.networkLogs({
            errorsOnly: values.errors,
            clear: values.clear,
            limit: parsedLimit,
          });
          if (values.json) {
            emitJson(res);
          } else if (res.logs.length === 0) {
            io.stdout('No network logs.');
          } else {
            for (const entry of res.logs) {
              const status = entry.failed
                ? `ERR(${entry.errorText ?? 'failed'})`
                : String(entry.status ?? '-');
              io.stdout(`[${status}] ${entry.method} ${entry.url}`);
            }
          }
          return 0;
        }

        const res = await client.consoleLogs({
          level: values.errors ? 'error' : undefined,
          clear: values.clear,
          limit: parsedLimit,
        });
        if (values.json) {
          emitJson(res);
        } else if (res.logs.length === 0) {
          io.stdout('No console logs.');
        } else {
          for (const entry of res.logs) {
            io.stdout(`[${entry.level}] ${entry.text}`);
          }
        }
        return 0;
      }

      case 'batch': {
        const jsonFile = args[0];
        if (!jsonFile) {
          io.stderr('Usage: agb batch <jsonFile>');
          return 1;
        }
        const raw = await io.readFile(jsonFile);
        const batchInput = parseBatchFileContent(raw);
        const res = await client.batch(batchInput.steps, {
          stopOnError: batchInput.stopOnError,
        });
        if (values.json) {
          emitJson(res);
        } else {
          io.stdout(
            `Batch ${res.success ? 'completed' : 'failed'}: ${res.completedSteps}/${res.totalSteps} steps (${res.durationMs}ms)`,
          );
          for (const r of res.results) {
            const mark = r.success ? 'OK' : 'FAIL';
            const errMsg = r.error ? ` — ${r.error}` : '';
            io.stdout(`  #${r.index + 1} [${mark}] ${r.action} (${r.durationMs}ms)${errMsg}`);
          }
        }
        return res.success ? 0 : 1;
      }

      default: {
        io.stderr(`Unknown command: ${command}`);
        io.stderr('Run "agb --help" for usage.');
        return 1;
      }
    }
  } catch (err) {
    const message =
      err instanceof BridgeClientError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    if (values.json) {
      emitJson({
        error: message,
        ...(err instanceof BridgeClientError && err.statusCode !== undefined
          ? { statusCode: err.statusCode }
          : {}),
      });
    } else {
      io.stderr(`Error: ${message}`);
    }
    return 1;
  }
}

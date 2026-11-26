import {
  AntigravityBridgeClient,
  type BatchStep,
  BridgeClientError,
  type ConsoleLogLevel,
  type ExecutionEngine,
  type KeyModifier,
} from '@antigravity-bridge/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

function okJson(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function failTool(err: unknown): CallToolResult {
  const message =
    err instanceof BridgeClientError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export function parseImageDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (match?.[1] && match[2] !== undefined) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/png', data: dataUrl };
}

export function createMcpBridgeServer(
  client: AntigravityBridgeClient = new AntigravityBridgeClient(),
): McpServer {
  const server = new McpServer({
    name: '@antigravity-bridge/mcp',
    version: '2.0.0',
  });

  server.registerTool(
    'browser_status',
    {
      title: 'Browser Bridge Status',
      description:
        'Check Antigravity Chrome Bridge connection status, active sessions, and pending command count.',
      inputSchema: {
        includeTraces: z.boolean().optional().describe('Include recent command traces'),
      },
    },
    async ({ includeTraces }) => {
      try {
        const status = await client.status();
        if (includeTraces) {
          const traces = await client.traces(10);
          return okJson({ ...status, recentTraces: traces.traces });
        }
        return okJson(status);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_navigate',
    {
      title: 'Navigate Browser Tab',
      description: 'Navigate the active or specified browser tab to a URL.',
      inputSchema: {
        url: z.string().min(1).describe('Target URL to navigate to'),
        tabId: z.number().int().positive().optional().describe('Optional target tab ID'),
        sessionId: z.string().min(1).optional().describe('Optional target session ID'),
      },
    },
    async ({ url, tabId, sessionId }) => {
      try {
        const res = await client.navigate(url, { tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_snapshot',
    {
      title: 'AI DOM Snapshot',
      description:
        'Capture an AI-friendly DOM snapshot with Set-of-Mark (@eN) element references, roles, labels, and bounding boxes.',
      inputSchema: {
        interactiveOnly: z
          .boolean()
          .optional()
          .describe('Only collect interactive elements (default: true)'),
        markOverlay: z
          .boolean()
          .optional()
          .describe('Render visual @eN badge overlay on the page and capture screenshot'),
        maxElements: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of elements to return'),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ interactiveOnly, markOverlay, maxElements, tabId, sessionId }) => {
      try {
        const res = await client.snapshot({
          interactiveOnly,
          markOverlay,
          maxElements,
          tabId,
          sessionId,
        });
        if (typeof res.image === 'string' && res.image.length > 0) {
          const { mimeType, data } = parseImageDataUrl(res.image);
          const { image: _omitted, ...rest } = res;
          return {
            content: [
              { type: 'text', text: JSON.stringify(rest, null, 2) },
              { type: 'image', data, mimeType },
            ],
          };
        }
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_click',
    {
      title: 'Click Element',
      description: 'Click an element identified by @eN snapshot ref or CSS selector.',
      inputSchema: {
        target: z.string().min(1).describe('Snapshot ref (e.g. @e1) or CSS selector'),
        engine: z.enum(['auto', 'scripting', 'cdp']).optional().describe('Execution engine'),
        allFrames: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ target, engine, allFrames, tabId, sessionId }) => {
      try {
        const res = await client.click(target, {
          engine: engine as ExecutionEngine | undefined,
          allFrames,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_type',
    {
      title: 'Type Text',
      description: 'Type text into an input/textarea identified by @eN ref or CSS selector.',
      inputSchema: {
        target: z.string().min(1).describe('Snapshot ref (e.g. @e2) or CSS selector'),
        text: z.string().describe('Text to type'),
        clear: z.boolean().optional().describe('Clear existing value before typing'),
        engine: z.enum(['auto', 'scripting', 'cdp']).optional(),
        allFrames: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ target, text, clear, engine, allFrames, tabId, sessionId }) => {
      try {
        const res = await client.type(target, text, {
          clear,
          engine: engine as ExecutionEngine | undefined,
          allFrames,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_press_key',
    {
      title: 'Press Keyboard Key',
      description: 'Dispatch a trusted CDP keyboard key event with optional modifiers.',
      inputSchema: {
        key: z.string().min(1).describe('Key name (e.g. Enter, Tab, Escape, a)'),
        modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
        target: z.string().min(1).optional().describe('Optional @eN ref or CSS selector to focus'),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ key, modifiers, target, tabId, sessionId }) => {
      try {
        const res = await client.pressKey(key, {
          modifiers: modifiers as KeyModifier[] | undefined,
          target,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_scroll',
    {
      title: 'Scroll Page or Element',
      description: 'Scroll the viewport or scroll an element into view.',
      inputSchema: {
        direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        amount: z.number().optional().describe('Scroll distance in pixels'),
        x: z.number().optional(),
        y: z.number().optional(),
        target: z.string().min(1).optional().describe('Optional @eN ref or CSS selector'),
        engine: z.enum(['auto', 'scripting', 'cdp']).optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ direction, amount, x, y, target, engine, tabId, sessionId }) => {
      try {
        const res = await client.scroll({
          direction,
          amount,
          x,
          y,
          target,
          engine: engine as ExecutionEngine | undefined,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Capture Screenshot',
      description: 'Capture a screenshot of the visible viewport, full page, or specific element.',
      inputSchema: {
        format: z.enum(['png', 'jpeg']).optional(),
        quality: z.number().int().min(0).max(100).optional(),
        fullPage: z.boolean().optional(),
        target: z.string().min(1).optional().describe('Optional @eN ref or CSS selector to crop'),
        markOverlay: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ format, quality, fullPage, target, markOverlay, tabId, sessionId }) => {
      try {
        const res = await client.screenshot({
          format,
          quality,
          fullPage,
          target,
          markOverlay,
          tabId,
          sessionId,
        });
        if (typeof res.image === 'string' && res.image.length > 0) {
          const { mimeType, data } = parseImageDataUrl(res.image);
          return {
            content: [
              { type: 'image', data, mimeType },
              {
                type: 'text',
                text: JSON.stringify({
                  success: res.success,
                  tabId: res.tabId,
                  ...(res.engine ? { engine: res.engine } : {}),
                }),
              },
            ],
          };
        }
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: 'Evaluate JavaScript',
      description: 'Execute JavaScript code in the active or specified tab and return the result.',
      inputSchema: {
        code: z.string().min(1).describe('JavaScript function body to evaluate'),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ code, tabId, sessionId }) => {
      try {
        const res = await client.evaluate(code, { tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_tabs',
    {
      title: 'List Browser Tabs',
      description: 'List all open browser tabs and group membership.',
      inputSchema: {
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ sessionId }) => {
      try {
        const res = await client.getTabs({ sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_console_logs',
    {
      title: 'Get Console Logs',
      description: 'Retrieve captured CDP console logs for the active or specified tab.',
      inputSchema: {
        level: z.enum(['all', 'error', 'warn', 'info', 'log']).optional(),
        limit: z.number().int().positive().optional(),
        clear: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ level, limit, clear, tabId, sessionId }) => {
      try {
        const res = await client.consoleLogs({
          level: level as ConsoleLogLevel | undefined,
          limit,
          clear,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_network_logs',
    {
      title: 'Get Network Logs',
      description: 'Retrieve captured CDP network requests and failures for a tab.',
      inputSchema: {
        urlPattern: z.string().min(1).optional(),
        errorsOnly: z.boolean().optional(),
        limit: z.number().int().positive().optional(),
        clear: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ urlPattern, errorsOnly, limit, clear, tabId, sessionId }) => {
      try {
        const res = await client.networkLogs({
          urlPattern,
          errorsOnly,
          limit,
          clear,
          tabId,
          sessionId,
        });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_batch',
    {
      title: 'Execute Batch Workflow',
      description: 'Execute a sequence of bridge commands in order via POST /api/v2/batch.',
      inputSchema: {
        steps: z
          .array(
            z.object({
              action: z.string().min(1),
              params: z.record(z.unknown()).optional(),
              delayMs: z.number().int().min(0).optional(),
            }),
          )
          .min(1),
        stopOnError: z.boolean().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ steps, stopOnError, sessionId }) => {
      try {
        const res = await client.batch(steps as BatchStep[], { stopOnError, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  return server;
}

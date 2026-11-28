import {
  AntigravityBridgeClient,
  type BatchStep,
  BridgeClientError,
  type ConsoleLogLevel,
  type ExecutionEngine,
  formatCompactSnapshot,
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
        format: z
          .enum(['json', 'compact'])
          .optional()
          .describe(
            'Output format: "compact" returns a token-efficient Accessibility-Tree style summary (~75% fewer tokens); default "json"',
          ),
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
        includeShadowDom: z.boolean().optional(),
        allFrames: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({
      format,
      interactiveOnly,
      markOverlay,
      maxElements,
      includeShadowDom,
      allFrames,
      tabId,
      sessionId,
    }) => {
      try {
        const res = await client.snapshot({
          interactiveOnly,
          markOverlay,
          maxElements,
          includeShadowDom,
          allFrames,
          tabId,
          sessionId,
        });
        const isCompact = format === 'compact';
        if (typeof res.image === 'string' && res.image.length > 0) {
          const { mimeType, data } = parseImageDataUrl(res.image);
          const { image: _omitted, ...rest } = res;
          const text = isCompact
            ? formatCompactSnapshot({
                url: res.url,
                title: res.title,
                elements: res.elements ?? [],
              })
            : JSON.stringify(rest, null, 2);
          return {
            content: [
              { type: 'text', text },
              { type: 'image', data, mimeType },
            ],
          };
        }
        if (isCompact) {
          return {
            content: [
              {
                type: 'text',
                text: formatCompactSnapshot({
                  url: res.url,
                  title: res.title,
                  elements: res.elements ?? [],
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

  server.registerTool(
    'browser_wait_for',
    {
      title: 'Wait For Element',
      description: 'Wait until an element matching the CSS selector appears in the DOM.',
      inputSchema: {
        selector: z.string().min(1).describe('CSS selector to wait for'),
        timeout: z.number().int().positive().optional().describe('Timeout in milliseconds'),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ selector, timeout, tabId, sessionId }) => {
      try {
        const res = await client.waitFor(selector, timeout, { tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_select',
    {
      title: 'Select Dropdown Option',
      description:
        'Select an option value on a <select> element identified by @eN ref or CSS selector.',
      inputSchema: {
        target: z.string().min(1).describe('Snapshot ref (e.g. @e3) or CSS selector'),
        value: z.string().describe('Option value to select'),
        engine: z.enum(['auto', 'scripting', 'cdp']).optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ target, value, engine, tabId, sessionId }) => {
      try {
        const res = await client.select(target, value, {
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
    'browser_hover',
    {
      title: 'Hover Element',
      description: 'Hover over an element identified by @eN ref or CSS selector.',
      inputSchema: {
        target: z.string().min(1).describe('Snapshot ref (e.g. @e1) or CSS selector'),
        engine: z.enum(['auto', 'scripting', 'cdp']).optional(),
        allFrames: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ target, engine, allFrames, tabId, sessionId }) => {
      try {
        const res = await client.hover(target, {
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
    'browser_get_text',
    {
      title: 'Get Visible Text',
      description: 'Extract visible text from the page or a specific element.',
      inputSchema: {
        selector: z
          .string()
          .min(1)
          .optional()
          .describe('Optional CSS selector (defaults to full page text)'),
        allFrames: z.boolean().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ selector, allFrames, tabId, sessionId }) => {
      try {
        const res = await client.getText(selector, { allFrames, tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_upload_file',
    {
      title: 'Upload File',
      description: 'Attach one or more local files to a file input via CDP.',
      inputSchema: {
        target: z.string().min(1).describe('Snapshot ref or CSS selector for <input type="file">'),
        files: z.array(z.string().min(1)).min(1).describe('Local file paths to upload'),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ target, files, tabId, sessionId }) => {
      try {
        const res = await client.uploadFile(target, files, { tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_drag_and_drop',
    {
      title: 'Drag and Drop',
      description:
        'Drag from a source element/coordinates and drop onto a target element/coordinates.',
      inputSchema: {
        sourceTarget: z.string().min(1).optional().describe('Source @eN ref or CSS selector'),
        targetTarget: z.string().min(1).optional().describe('Destination @eN ref or CSS selector'),
        sourceX: z.number().optional(),
        sourceY: z.number().optional(),
        targetX: z.number().optional(),
        targetY: z.number().optional(),
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({
      sourceTarget,
      targetTarget,
      sourceX,
      sourceY,
      targetX,
      targetY,
      tabId,
      sessionId,
    }) => {
      try {
        const res = await client.dragAndDrop({
          sourceTarget,
          targetTarget,
          sourceX,
          sourceY,
          targetX,
          targetY,
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
    'browser_new_tab',
    {
      title: 'Open New Tab',
      description: 'Open a new browser tab in the Antigravity tab group.',
      inputSchema: {
        url: z.string().min(1).optional().describe('Optional URL to open in the new tab'),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ url, sessionId }) => {
      try {
        const res = await client.newTab(url, { sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_close_tab',
    {
      title: 'Close Browser Tab',
      description: 'Close the active or specified browser tab.',
      inputSchema: {
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ tabId, sessionId }) => {
      try {
        const res = await client.closeTab({ tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_switch_tab',
    {
      title: 'Switch Browser Tab',
      description: 'Activate a browser tab by ID.',
      inputSchema: {
        tabId: z.number().int().positive().describe('Target tab ID to activate'),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ tabId, sessionId }) => {
      try {
        const res = await client.switchTab(tabId, { sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_reload',
    {
      title: 'Reload Browser Tab',
      description: 'Reload the active or specified browser tab.',
      inputSchema: {
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ tabId, sessionId }) => {
      try {
        const res = await client.reload({ tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_go_back',
    {
      title: 'Navigate Back',
      description: 'Navigate backward in browser history for the active or specified tab.',
      inputSchema: {
        tabId: z.number().int().positive().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ tabId, sessionId }) => {
      try {
        const res = await client.goBack({ tabId, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  server.registerTool(
    'browser_workflows',
    {
      title: 'Saved Browser Workflows',
      description: 'List saved workflows on the bridge server or run a saved workflow by ID.',
      inputSchema: {
        action: z
          .enum(['list', 'run'])
          .describe('Workflow operation: "list" saved workflows or "run" a workflow by ID'),
        workflowId: z
          .string()
          .min(1)
          .optional()
          .describe('Workflow ID to execute (required when action is "run")'),
        stopOnError: z.boolean().optional(),
        sessionId: z.string().min(1).optional(),
      },
    },
    async ({ action, workflowId, stopOnError, sessionId }) => {
      try {
        if (action === 'list') {
          const res = await client.listWorkflows();
          return okJson(res);
        }
        if (!workflowId) {
          return failTool(new Error('workflowId is required when action is "run"'));
        }
        const res = await client.runWorkflow(workflowId, { stopOnError, sessionId });
        return okJson(res);
      } catch (err) {
        return failTool(err);
      }
    },
  );

  return server;
}

import { COMMAND_ACTIONS, DEFAULT_HTTP_PORT, DEFAULT_WS_PORT } from '@antigravity-bridge/protocol';

const ACTION_DESCRIPTIONS: Record<string, string> = {
  navigate: 'Navigate the target tab to a URL and wait for load completion',
  new_tab: 'Open a new tab inside the Antigravity tab group',
  close_tab: 'Close the target tab',
  switch_tab: 'Activate and focus a tab by tabId',
  go_back: 'Navigate backward in tab history',
  go_forward: 'Navigate forward in tab history',
  reload: 'Reload the target tab',
  get_url: 'Return current URL, title, and tabId',
  get_tabs: 'List tabs in the Antigravity group and all browser tabs',
  click: 'Click an element by CSS selector or @eN ref (scripting or CDP)',
  click_at: 'Click at viewport coordinates (x, y)',
  type: 'Type text into an input/textarea by CSS selector or @eN ref',
  hover: 'Hover over an element by CSS selector or @eN ref',
  select: 'Select an option value in a <select> element',
  scroll: 'Scroll the page or a target element',
  get_content: 'Return outerHTML of the document or a matching element',
  get_text: 'Return innerText of the document or a matching element',
  get_elements: 'Query elements matching a selector with bounding rects',
  screenshot: 'Capture visible tab, full page, element clip, or SoM-annotated screenshot',
  iframe_click: 'Click an element inside an iframe',
  iframe_click_at: 'Click coordinates inside an iframe',
  iframe_get_elements: 'Query elements inside an iframe',
  iframe_get_text: 'Extract innerText from an iframe',
  evaluate: 'Execute JavaScript in the page context',
  wait_for: 'Wait for a selector to appear in the DOM',
  snapshot:
    'Scan interactive/semantic DOM elements, assign @eN refs, optionally render SoM overlay',
  clear_marks: 'Remove the Set-of-Mark (#__agb_som_overlay__) overlay from the page',
  press_key: 'Dispatch keyboard events (key, modifiers, optional target focus) via CDP',
  drag_and_drop: 'Drag and drop between selectors/refs or coordinates via CDP mouse events',
  upload_file: 'Attach local file paths to a file input via CDP DOM.setFileInputFiles',
  get_console_logs: 'Read per-tab CDP console and uncaught exception logs',
  get_network_logs: 'Read per-tab CDP network request/response/failure logs',
};

export function buildOpenApiSpec(serverUrl = `http://127.0.0.1:${DEFAULT_HTTP_PORT}`) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Antigravity Chrome Bridge API',
      version: '2.0.0',
      description:
        'HTTP + WebSocket bridge API for controlling Chrome from AI agents, SDKs, CLI, and MCP servers.',
    },
    servers: [
      {
        url: serverUrl,
        description: `Local Antigravity Bridge HTTP server (WS on port ${DEFAULT_WS_PORT})`,
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Server is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/status': {
        get: {
          summary: 'Bridge connection status',
          operationId: 'getStatus',
          responses: {
            '200': {
              description: 'Connection status and active extension sessions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StatusResponse' },
                },
              },
            },
          },
        },
      },
      '/command': {
        post: {
          summary: 'Execute a single browser command',
          operationId: 'executeCommand',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CommandRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Command executed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CommandResponse' },
                },
              },
            },
            '400': { description: 'Invalid request body' },
            '503': { description: 'No connected Chrome extension session' },
            '504': { description: 'Command timed out or extension disconnected' },
          },
        },
      },
      '/api/v2/batch': {
        post: {
          summary: 'Execute a sequence of browser commands',
          operationId: 'executeBatch',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BatchRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Batch execution summary and step results',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BatchResponse' },
                },
              },
            },
            '400': { description: 'Invalid batch request body' },
            '503': { description: 'No connected Chrome extension session' },
          },
        },
      },
      '/api/v2/sessions': {
        get: {
          summary: 'List connected Chrome extension sessions',
          operationId: 'listSessions',
          responses: {
            '200': {
              description: 'Connected sessions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SessionsResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v2/traces': {
        get: {
          summary: 'List recent command execution traces',
          operationId: 'listTraces',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1 },
            },
          ],
          responses: {
            '200': {
              description: 'Recent trace entries',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TracesResponse' },
                },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI 3.1 JSON specification',
          operationId: 'getOpenApiSpec',
          responses: {
            '200': { description: 'OpenAPI JSON document' },
          },
        },
      },
      '/docs': {
        get: {
          summary: 'HTML API reference viewer',
          operationId: 'getDocsHtml',
          responses: {
            '200': {
              description: 'Self-contained HTML API documentation',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CommandAction: {
          type: 'string',
          enum: [...COMMAND_ACTIONS],
          description: 'Supported browser automation actions (v1 + v2)',
        },
        CommandRequest: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { $ref: '#/components/schemas/CommandAction' },
            params: { type: 'object', additionalProperties: true },
            sessionId: { type: 'string' },
          },
        },
        CommandResponse: {
          type: 'object',
          required: ['success', 'id', 'result'],
          properties: {
            success: { type: 'boolean' },
            id: { type: 'string' },
            result: { type: 'object', additionalProperties: true },
          },
        },
        BatchStep: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { $ref: '#/components/schemas/CommandAction' },
            params: { type: 'object', additionalProperties: true },
            delayMs: { type: 'integer', minimum: 0 },
          },
        },
        BatchRequest: {
          type: 'object',
          required: ['steps'],
          properties: {
            steps: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/components/schemas/BatchStep' },
            },
            stopOnError: { type: 'boolean', default: true },
            sessionId: { type: 'string' },
          },
        },
        BatchStepResult: {
          type: 'object',
          required: ['index', 'action', 'success', 'durationMs'],
          properties: {
            index: { type: 'integer' },
            action: { type: 'string' },
            success: { type: 'boolean' },
            id: { type: 'string' },
            durationMs: { type: 'number' },
            result: { type: 'object', additionalProperties: true },
            error: { type: 'string' },
          },
        },
        BatchResponse: {
          type: 'object',
          required: ['success', 'completedSteps', 'totalSteps', 'durationMs', 'results'],
          properties: {
            success: { type: 'boolean' },
            completedSteps: { type: 'integer' },
            totalSteps: { type: 'integer' },
            durationMs: { type: 'number' },
            results: {
              type: 'array',
              items: { $ref: '#/components/schemas/BatchStepResult' },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['status', 'timestamp'],
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'number' },
          },
        },
        SessionSummary: {
          type: 'object',
          required: ['sessionId', 'profile', 'connectedAt', 'lastSeenAt', 'active'],
          properties: {
            sessionId: { type: 'string' },
            profile: { type: 'string' },
            connectedAt: { type: 'number' },
            lastSeenAt: { type: 'number' },
            remoteAddress: { type: 'string' },
            version: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        StatusResponse: {
          type: 'object',
          required: ['connected', 'pendingCommands', 'uptime', 'sessionsCount', 'sessions'],
          properties: {
            connected: { type: 'boolean' },
            pendingCommands: { type: 'integer' },
            uptime: { type: 'number' },
            sessionsCount: { type: 'integer' },
            sessions: {
              type: 'array',
              items: { $ref: '#/components/schemas/SessionSummary' },
            },
          },
        },
        SessionsResponse: {
          type: 'object',
          required: ['sessions', 'count'],
          properties: {
            sessions: {
              type: 'array',
              items: { $ref: '#/components/schemas/SessionSummary' },
            },
            count: { type: 'integer' },
          },
        },
        TraceEntry: {
          type: 'object',
          required: ['id', 'sessionId', 'action', 'startedAt', 'durationMs', 'success'],
          properties: {
            id: { type: 'string' },
            sessionId: { type: 'string' },
            action: { type: 'string' },
            startedAt: { type: 'number' },
            durationMs: { type: 'number' },
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        TracesResponse: {
          type: 'object',
          required: ['traces', 'count'],
          properties: {
            traces: {
              type: 'array',
              items: { $ref: '#/components/schemas/TraceEntry' },
            },
            count: { type: 'integer' },
          },
        },
      },
    },
    'x-actions': COMMAND_ACTIONS.map((action) => ({
      action,
      description: ACTION_DESCRIPTIONS[action] ?? '',
    })),
  };
}

export function renderDocsHtml(): string {
  const actionRows = COMMAND_ACTIONS.map(
    (action) =>
      `<tr><td><code>${action}</code></td><td>${ACTION_DESCRIPTIONS[action] ?? ''}</td></tr>`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Antigravity Chrome Bridge v2 API Reference</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
    body { max-width: 960px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55; }
    h1, h2 { border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
    code { background: #8882; padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.92em; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #8883; }
    .badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 4px; font-weight: 600; font-size: 0.8em; background: #1a73e8; color: #fff; }
  </style>
</head>
<body>
  <h1>Antigravity Chrome Bridge v2.0 API Reference</h1>
  <p>Machine-readable schema: <a href="/openapi.json"><code>GET /openapi.json</code></a></p>

  <h2>HTTP Endpoints</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="badge">GET</span></td><td><code>/health</code></td><td>Health check</td></tr>
      <tr><td><span class="badge">GET</span></td><td><code>/status</code></td><td>Bridge connection status and active sessions</td></tr>
      <tr><td><span class="badge">POST</span></td><td><code>/command</code></td><td>Execute a single browser command</td></tr>
      <tr><td><span class="badge">POST</span></td><td><code>/api/v2/batch</code></td><td>Execute a sequential batch of commands</td></tr>
      <tr><td><span class="badge">GET</span></td><td><code>/api/v2/sessions</code></td><td>List connected Chrome extension sessions</td></tr>
      <tr><td><span class="badge">GET</span></td><td><code>/api/v2/traces</code></td><td>List recent command execution traces</td></tr>
      <tr><td><span class="badge">GET</span></td><td><code>/openapi.json</code></td><td>OpenAPI 3.1 JSON specification</td></tr>
      <tr><td><span class="badge">GET</span></td><td><code>/docs</code></td><td>This HTML reference page</td></tr>
    </tbody>
  </table>

  <h2>Supported Actions (${COMMAND_ACTIONS.length})</h2>
  <table>
    <thead><tr><th>Action</th><th>Description</th></tr></thead>
    <tbody>
      ${actionRows}
    </tbody>
  </table>
</body>
</html>`;
}

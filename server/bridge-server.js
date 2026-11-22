// ============================================================================
// Antigravity Chrome Bridge Server
// ============================================================================
// A bridge server that connects the Antigravity AI coding assistant with a
// Chrome extension via WebSocket (for the extension) and HTTP API (for the
// assistant). Commands are sent over HTTP, forwarded to the extension via
// WebSocket, and responses are returned back through the HTTP response.
// ============================================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const HOST = process.env.HOST || '127.0.0.1';
const WS_PORT = Number(process.env.WS_PORT) || 8767;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 8766;
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS) || 30_000; // 30 seconds default timeout

// ---------------------------------------------------------------------------
// Colored console logging helpers
// ---------------------------------------------------------------------------
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(color, label, message) {
  console.log(
    `${colors.dim}[${timestamp()}]${colors.reset} ${color}[${label}]${colors.reset} ${message}`
  );
}

const logInfo = (msg) => log(colors.cyan, 'INFO', msg);
const logSuccess = (msg) => log(colors.green, ' OK ', msg);
const logWarn = (msg) => log(colors.yellow, 'WARN', msg);
const logError = (msg) => log(colors.red, ' ERR', msg);
const logWs = (msg) => log(colors.magenta, ' WS ', msg);
const logHttp = (msg) => log(colors.blue, 'HTTP', msg);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {import('ws').WebSocket | null} */
let extensionClient = null;

/**
 * Pending command callbacks, keyed by command ID.
 * Each entry holds { resolve, reject, timer } so we can settle the promise
 * when a response arrives or the timeout fires.
 * @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>}
 */
const pendingCommands = new Map();

// ---------------------------------------------------------------------------
// WebSocket Server — for the Chrome extension
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ host: HOST, port: WS_PORT });

wss.on('listening', () => {
  logSuccess(`WebSocket server listening on ws://${HOST}:${WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  logWs(`Extension connected from ${clientIp}`);

  // Only allow a single extension client at a time
  if (extensionClient && extensionClient.readyState === extensionClient.OPEN) {
    logWarn('Another extension was already connected — replacing old connection');
    extensionClient.close(1000, 'Replaced by new connection');
  }

  extensionClient = ws;

  // ---- Incoming messages from the extension ----
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      logWarn(`Received non-JSON message from extension: ${raw.toString().substring(0, 200)}`);
      return;
    }

    // Handle keepalive / ping
    if (data.type === 'ping' || data.type === 'keepalive') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      return;
    }

    // Handle command responses
    if (data.id && pendingCommands.has(data.id)) {
      const pending = pendingCommands.get(data.id);
      clearTimeout(pending.timer);
      pendingCommands.delete(data.id);
      logInfo(`Response received for command ${data.id}`);
      pending.resolve(data);
      return;
    }

    // Unrecognized message — log it
    logWarn(`Unhandled message from extension: ${JSON.stringify(data).substring(0, 300)}`);
  });

  // ---- Disconnection ----
  ws.on('close', (code, reason) => {
    logWs(`Extension disconnected (code=${code}, reason=${reason || 'none'})`);
    if (extensionClient === ws) {
      extensionClient = null;
    }

    // Reject any pending commands that were waiting on this connection
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension disconnected while waiting for response'));
      pendingCommands.delete(id);
    }
  });

  ws.on('error', (err) => {
    logError(`WebSocket error: ${err.message}`);
  });

  // Notify the extension that the bridge is ready
  ws.send(JSON.stringify({ type: 'bridge_ready', timestamp: Date.now() }));
});

wss.on('error', (err) => {
  logError(`WebSocket server error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// HTTP API Server — for the Antigravity assistant
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// ---- POST /command ----
// Send a command to the Chrome extension and wait for a response.
app.post('/command', async (req, res) => {
  const { action, params } = req.body || {};

  if (!action) {
    logHttp('POST /command — missing "action" in request body');
    return res.status(400).json({ error: 'Missing "action" in request body' });
  }

  if (!extensionClient || extensionClient.readyState !== extensionClient.OPEN) {
    logHttp('POST /command — extension not connected');
    return res.status(503).json({ error: 'Chrome extension is not connected' });
  }

  const commandId = crypto.randomUUID();
  const command = { id: commandId, action, params: params || {} };

  logHttp(`POST /command — action="${action}" id=${commandId}`);

  try {
    const result = await sendCommandAndWait(command);
    logSuccess(`Command ${commandId} completed`);
    res.json({ success: true, id: commandId, result });
  } catch (err) {
    logError(`Command ${commandId} failed: ${err.message}`);
    res.status(504).json({ error: err.message, id: commandId });
  }
});

// ---- GET /status ----
// Check whether the extension is currently connected.
app.get('/status', (_req, res) => {
  const connected =
    extensionClient !== null && extensionClient.readyState === extensionClient.OPEN;
  logHttp(`GET /status — connected=${connected}`);
  res.json({
    connected,
    pendingCommands: pendingCommands.size,
    uptime: process.uptime(),
  });
});

// ---- GET /health ----
// Simple health check.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---- Catch-all for unknown routes ----
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the HTTP server
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, HOST, () => {
  logSuccess(`HTTP API server listening on http://${HOST}:${HTTP_PORT}`);
});

// ---------------------------------------------------------------------------
// Command queue helper
// ---------------------------------------------------------------------------

/**
 * Sends a command object to the extension over WebSocket and returns a
 * promise that resolves when the extension sends back a response with the
 * matching command ID, or rejects on timeout.
 *
 * @param {{ id: string, action: string, params: object }} command
 * @returns {Promise<object>}
 */
function sendCommandAndWait(command) {
  return new Promise((resolve, reject) => {
    // Set up timeout
    const timer = setTimeout(() => {
      pendingCommands.delete(command.id);
      reject(new Error(`Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`));
    }, COMMAND_TIMEOUT_MS);

    // Register in pending map
    pendingCommands.set(command.id, { resolve, reject, timer });

    // Send to extension
    try {
      extensionClient.send(JSON.stringify(command));
    } catch (err) {
      clearTimeout(timer);
      pendingCommands.delete(command.id);
      reject(new Error(`Failed to send command: ${err.message}`));
    }
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown() {
  logWarn('Shutting down bridge server...');

  // Reject all pending commands
  for (const [id, pending] of pendingCommands) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Server shutting down'));
    pendingCommands.delete(id);
  }

  // Close WebSocket server
  wss.close(() => {
    logInfo('WebSocket server closed');
  });

  // Close HTTP server
  httpServer.close(() => {
    logInfo('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    logError('Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------
console.log('');
console.log(
  `${colors.bgBlue}${colors.white}${colors.bright}                                                  ${colors.reset}`
);
console.log(
  `${colors.bgBlue}${colors.white}${colors.bright}    Antigravity Chrome Bridge Server               ${colors.reset}`
);
console.log(
  `${colors.bgBlue}${colors.white}${colors.bright}                                                  ${colors.reset}`
);
console.log('');
console.log(
  `  ${colors.cyan}HTTP API${colors.reset}    →  ${colors.bright}http://localhost:${HTTP_PORT}${colors.reset}`
);
console.log(
  `  ${colors.magenta}WebSocket${colors.reset}   →  ${colors.bright}ws://localhost:${WS_PORT}${colors.reset}`
);
console.log('');
console.log(
  `  ${colors.dim}Endpoints:${colors.reset}`
);
console.log(
  `    ${colors.green}POST${colors.reset} /command   — Send command to extension`
);
console.log(
  `    ${colors.green}GET ${colors.reset} /status    — Check extension connection`
);
console.log(
  `    ${colors.green}GET ${colors.reset} /health    — Server health check`
);
console.log('');
console.log(
  `  ${colors.dim}Waiting for Chrome extension to connect on ws://localhost:${WS_PORT}...${colors.reset}`
);
console.log('');

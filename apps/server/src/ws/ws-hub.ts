import { HelloMessageSchema } from '@antigravity-bridge/protocol';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Logger } from '../logger.js';
import type { SessionManager } from '../services/session-manager.js';

export function attachWsHub(
  wss: WebSocketServer,
  sessionManager: SessionManager,
  logger: Logger,
): void {
  wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    const initialSession = sessionManager.registerConnection(ws, clientIp);
    logger.ws(`Extension connected (${initialSession.sessionId}) from ${clientIp ?? 'unknown'}`);

    ws.on('message', (raw) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        logger.warn(
          `Received non-JSON message from extension: ${raw.toString().substring(0, 200)}`,
        );
        return;
      }

      sessionManager.touchSocket(ws);

      // Handle keepalive / ping
      if (data.type === 'ping' || data.type === 'keepalive') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      // Handle v2 hello handshake
      if (data.type === 'hello') {
        const parsed = HelloMessageSchema.safeParse(data);
        if (parsed.success) {
          const updated = sessionManager.updateSessionMetadata(ws, {
            sessionId: parsed.data.sessionId,
            profile: parsed.data.profile,
            version: parsed.data.version,
          });
          logger.ws(
            `Handshake hello: session=${updated?.sessionId ?? 'unknown'} profile=${updated?.profile ?? 'default'}`,
          );
          ws.send(
            JSON.stringify({
              type: 'bridge_ready',
              timestamp: Date.now(),
              sessionId: updated?.sessionId,
            }),
          );
        } else {
          logger.warn(`Invalid hello payload: ${parsed.error.message}`);
        }
        return;
      }

      // Handle command responses
      if (typeof data.id === 'string') {
        const matched = sessionManager.resolveCommandResponse(ws, data);
        if (matched) {
          logger.info(`Response received for command ${data.id}`);
          return;
        }
      }

      logger.warn(`Unhandled message from extension: ${JSON.stringify(data).substring(0, 300)}`);
    });

    ws.on('close', (code, reason) => {
      const session = sessionManager.getSessionBySocket(ws);
      logger.ws(
        `Extension disconnected (${session?.sessionId ?? 'unknown'}, code=${code}, reason=${reason.toString() || 'none'})`,
      );
      sessionManager.disconnectSocket(ws);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
    });

    // Notify the extension immediately that the bridge is ready (v1 compatibility)
    ws.send(
      JSON.stringify({
        type: 'bridge_ready',
        timestamp: Date.now(),
        sessionId: initialSession.sessionId,
      }),
    );
  });

  wss.on('error', (err) => {
    logger.error(`WebSocket server error: ${err.message}`);
  });
}

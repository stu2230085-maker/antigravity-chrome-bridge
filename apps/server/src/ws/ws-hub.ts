import { HelloMessageSchema } from '@antigravity-bridge/protocol';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Logger } from '../logger.js';
import { isAllowedOrigin, tokensMatch } from '../middleware/security.js';
import type { SessionManager } from '../services/session-manager.js';

export interface WsHubAuthOptions {
  authToken?: string;
  wsRequireToken?: boolean;
  allowedOrigins?: string[];
}

export function attachWsHub(
  wss: WebSocketServer,
  sessionManager: SessionManager,
  logger: Logger,
  authOptions: WsHubAuthOptions = {},
): void {
  const expectedToken = authOptions.authToken?.trim() || undefined;
  const requireToken = Boolean(authOptions.wsRequireToken && expectedToken);

  wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(origin, authOptions.allowedOrigins)) {
      logger.warn(
        `Rejected WebSocket connection from ${clientIp ?? 'unknown'}: forbidden origin "${origin}"`,
      );
      ws.close(4003, 'Forbidden origin');
      return;
    }
    let queryToken: string | undefined;
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      queryToken = reqUrl.searchParams.get('token')?.trim() || undefined;
    } catch {
      queryToken = undefined;
    }

    if (requireToken && expectedToken && queryToken && !tokensMatch(expectedToken, queryToken)) {
      logger.warn(`Rejected WebSocket connection from ${clientIp ?? 'unknown'}: invalid token`);
      ws.close(4001, 'Unauthorized');
      return;
    }

    let authenticated = !requireToken || Boolean(queryToken && expectedToken);
    let initialSession = authenticated
      ? sessionManager.registerConnection(ws, clientIp)
      : undefined;

    if (initialSession) {
      logger.ws(`Extension connected (${initialSession.sessionId}) from ${clientIp ?? 'unknown'}`);
      ws.send(
        JSON.stringify({
          type: 'bridge_ready',
          timestamp: Date.now(),
          sessionId: initialSession.sessionId,
        }),
      );
    }

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

      // Handle v2 hello handshake
      if (data.type === 'hello') {
        const parsed = HelloMessageSchema.safeParse(data);
        if (!parsed.success) {
          logger.warn(`Invalid hello payload: ${parsed.error.message}`);
          if (!authenticated) {
            ws.close(4001, 'Unauthorized');
          }
          return;
        }

        if (!authenticated && requireToken && expectedToken) {
          if (!tokensMatch(expectedToken, parsed.data.token)) {
            logger.warn(
              `Rejected WebSocket hello from ${clientIp ?? 'unknown'}: invalid or missing token`,
            );
            ws.close(4001, 'Unauthorized');
            return;
          }
          authenticated = true;
          initialSession = sessionManager.registerConnection(ws, clientIp);
          logger.ws(
            `Extension connected (${initialSession.sessionId}) from ${clientIp ?? 'unknown'}`,
          );
        }

        sessionManager.touchSocket(ws);
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
        return;
      }

      if (!authenticated) {
        logger.warn(
          `Rejected unauthenticated WebSocket message (${String(data.type ?? 'unknown')})`,
        );
        ws.close(4001, 'Unauthorized');
        return;
      }

      sessionManager.touchSocket(ws);

      // Handle keepalive / ping
      if (data.type === 'ping' || data.type === 'keepalive') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
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
      if (session) {
        logger.ws(
          `Extension disconnected (${session.sessionId}, code=${code}, reason=${reason.toString() || 'none'})`,
        );
        sessionManager.disconnectSocket(ws);
      }
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
    });
  });

  wss.on('error', (err) => {
    logger.error(`WebSocket server error: ${err.message}`);
  });
}

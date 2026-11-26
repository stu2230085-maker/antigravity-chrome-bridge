import { HttpCommandRequestSchema } from '@antigravity-bridge/protocol';
import { Hono } from 'hono';
import type { Logger } from '../logger.js';
import { NoConnectedSessionError, type SessionManager } from '../services/session-manager.js';
import type { TraceStore } from '../services/trace-store.js';

export function createApiApp(
  sessionManager: SessionManager,
  traceStore: TraceStore,
  logger: Logger,
): Hono {
  const app = new Hono();

  app.post('/command', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }

    const parsed = HttpCommandRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.http('POST /command — missing "action" in request body');
      return c.json({ error: 'Missing "action" in request body' }, 400);
    }

    const { action, params = {}, sessionId } = parsed.data;

    try {
      const outcome = await sessionManager.sendCommand(action, params, sessionId);
      logger.success(`Command ${outcome.id} completed (${action})`);
      return c.json({
        success: true,
        id: outcome.id,
        result: outcome.result,
      });
    } catch (err) {
      if (err instanceof NoConnectedSessionError) {
        logger.http(`POST /command — ${err.message}`);
        return c.json({ error: err.message }, 503);
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Command failed (${action}): ${message}`);
      return c.json({ error: message }, 504);
    }
  });

  app.get('/status', (c) => {
    const sessions = sessionManager.listSessions();
    const connected = sessions.length > 0;
    logger.http(`GET /status — connected=${connected} sessions=${sessions.length}`);
    return c.json({
      connected,
      pendingCommands: sessionManager.getPendingCount(),
      uptime: process.uptime(),
      sessionsCount: sessions.length,
      sessions,
    });
  });

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: Date.now(),
    });
  });

  app.get('/api/v2/sessions', (c) => {
    const sessions = sessionManager.listSessions();
    return c.json({
      sessions,
      count: sessions.length,
    });
  });

  app.get('/api/v2/traces', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const traces = traceStore.list(Number.isFinite(limit) ? limit : undefined);
    return c.json({
      traces,
      count: traces.length,
    });
  });

  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}

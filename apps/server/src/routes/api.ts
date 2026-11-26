import {
  BatchRequestSchema,
  type BatchStepResult,
  HttpCommandRequestSchema,
} from '@antigravity-bridge/protocol';
import { Hono } from 'hono';
import type { Logger } from '../logger.js';
import { NoConnectedSessionError, type SessionManager } from '../services/session-manager.js';
import type { TraceStore } from '../services/trace-store.js';
import { buildOpenApiSpec, renderDocsHtml } from './openapi.js';

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

  app.post('/api/v2/batch', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }

    const parsed = BatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.http('POST /api/v2/batch — invalid request body');
      return c.json({ error: 'Invalid batch request: non-empty "steps" array is required' }, 400);
    }

    const { steps, stopOnError = true, sessionId } = parsed.data;
    if (!sessionManager.resolveTargetSession(sessionId)) {
      const msg = sessionId
        ? `Chrome extension session "${sessionId}" is not connected`
        : 'Chrome extension is not connected';
      logger.http(`POST /api/v2/batch — ${msg}`);
      return c.json({ error: msg }, 503);
    }

    const batchStartedAt = Date.now();
    const results: BatchStepResult[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      const stepStartedAt = Date.now();
      try {
        const outcome = await sessionManager.sendCommand(step.action, step.params ?? {}, sessionId);
        const stepSuccess = outcome.result.success !== false;
        const stepError =
          typeof outcome.result.error === 'string' ? outcome.result.error : undefined;

        results.push({
          index: i,
          action: step.action,
          success: stepSuccess,
          id: outcome.id,
          durationMs: Date.now() - stepStartedAt,
          result: outcome.result,
          ...(stepError ? { error: stepError } : {}),
        });

        if (!stepSuccess && stopOnError) {
          break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          index: i,
          action: step.action,
          success: false,
          durationMs: Date.now() - stepStartedAt,
          error: message,
        });

        if (stopOnError) {
          break;
        }
      }

      if (step.delayMs && step.delayMs > 0 && i < steps.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      }
    }

    const completedSteps = results.filter((r) => r.success).length;
    const success = results.length === steps.length && completedSteps === steps.length;

    return c.json({
      success,
      completedSteps,
      totalSteps: steps.length,
      durationMs: Date.now() - batchStartedAt,
      results,
    });
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

  app.get('/openapi.json', (c) => {
    const url = new URL(c.req.url);
    return c.json(buildOpenApiSpec(`${url.protocol}//${url.host}`));
  });

  app.get('/docs', (c) => {
    return c.html(renderDocsHtml());
  });

  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}

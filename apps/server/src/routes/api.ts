import {
  BatchRequestSchema,
  type BatchStep,
  type BatchStepResult,
  HttpCommandRequestSchema,
  validateTypedCommand,
  WorkflowRunRequestSchema,
  WorkflowUpsertSchema,
} from '@antigravity-bridge/protocol';
import { Hono } from 'hono';
import type { Logger } from '../logger.js';
import {
  createAuthMiddleware,
  createCsrfAndOriginMiddleware,
  createRateLimitMiddleware,
  type SecurityConfig,
  validateCommandPolicy,
} from '../middleware/security.js';
import type { BridgeEventBus } from '../services/event-bus.js';
import { NoConnectedSessionError, type SessionManager } from '../services/session-manager.js';
import type { TraceStore } from '../services/trace-store.js';
import type { WorkflowStore } from '../services/workflow-store.js';
import { readDashboardAsset, resolveDashboardDistDir } from './dashboard.js';
import { buildOpenApiSpec, renderDocsHtml } from './openapi.js';

interface BatchExecutionSummary {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  results: BatchStepResult[];
}

async function executeBatchSteps(
  sessionManager: SessionManager,
  steps: BatchStep[],
  stopOnError: boolean,
  sessionId?: string,
): Promise<BatchExecutionSummary> {
  const batchStartedAt = Date.now();
  const results: BatchStepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    const stepStartedAt = Date.now();
    try {
      const outcome = await sessionManager.sendCommand(step.action, step.params ?? {}, sessionId);
      const stepSuccess = outcome.result.success !== false;
      const stepError = typeof outcome.result.error === 'string' ? outcome.result.error : undefined;

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

  return {
    success,
    completedSteps,
    totalSteps: steps.length,
    durationMs: Date.now() - batchStartedAt,
    results,
  };
}

function formatSseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function findPolicyViolation(
  steps: BatchStep[],
  securityConfig: SecurityConfig,
): { index: number; action: string; reason: string } | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const check = validateCommandPolicy(step.action, step.params ?? {}, securityConfig);
    if (!check.allowed) {
      return { index: i, action: step.action, reason: check.reason };
    }
  }
  return null;
}

function findInvalidStep(
  steps: BatchStep[],
): { index: number; action: string; error: string } | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const stepCheck = validateTypedCommand(step.action, step.params ?? {});
    if (!stepCheck.ok) {
      return { index: i, action: step.action, error: stepCheck.error };
    }
  }
  return null;
}

export function createApiApp(
  sessionManager: SessionManager,
  traceStore: TraceStore,
  logger: Logger,
  workflowStore: WorkflowStore,
  eventBus: BridgeEventBus,
  dashboardDir?: string,
  securityConfig: SecurityConfig = {},
): Hono {
  const app = new Hono();
  const resolvedDashboardDir = resolveDashboardDistDir(dashboardDir);

  const rateLimiter = createRateLimitMiddleware(securityConfig);
  const csrfAndOrigin = createCsrfAndOriginMiddleware(securityConfig);
  const authMiddleware = createAuthMiddleware(securityConfig);

  app.use('/command', rateLimiter, csrfAndOrigin, authMiddleware);
  app.use('/status', rateLimiter, csrfAndOrigin, authMiddleware);
  app.use('/api/v2/*', rateLimiter, csrfAndOrigin, authMiddleware);

  app.get('/', (c) => {
    return c.json({
      name: 'Antigravity Chrome Bridge',
      version: '2.0.0',
      dashboard: '/ui',
      docs: '/docs',
      openapi: '/openapi.json',
      status: '/status',
      health: '/health',
    });
  });

  app.get('/ui', (c) => {
    return c.redirect('/ui/');
  });

  app.get('/ui/*', (c) => {
    const asset = readDashboardAsset(resolvedDashboardDir, c.req.path);
    if (!asset) {
      return c.json(
        {
          error:
            'Dashboard assets not found. Run "pnpm --filter @antigravity-bridge/dashboard build".',
        },
        404,
      );
    }
    return new Response(new Uint8Array(asset.content), {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'no-cache',
      },
    });
  });

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
    const policy = validateCommandPolicy(action, params, securityConfig);
    if (!policy.allowed) {
      logger.warn(`Policy rejected POST /command (${action}): ${policy.reason}`);
      return c.json({ error: policy.reason }, 403);
    }

    const cmdCheck = validateTypedCommand(action, params);
    if (!cmdCheck.ok) {
      logger.http(`POST /command — ${cmdCheck.error}`);
      return c.json({ error: cmdCheck.error }, 400);
    }

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
    const violation = findPolicyViolation(steps, securityConfig);
    if (violation) {
      logger.warn(
        `Policy rejected POST /api/v2/batch step #${violation.index} (${violation.action}): ${violation.reason}`,
      );
      return c.json(
        {
          error: violation.reason,
          stepIndex: violation.index,
          action: violation.action,
        },
        403,
      );
    }

    const invalidStep = findInvalidStep(steps);
    if (invalidStep) {
      logger.http(
        `POST /api/v2/batch — invalid step #${invalidStep.index} (${invalidStep.action}): ${invalidStep.error}`,
      );
      return c.json(
        {
          error: invalidStep.error,
          stepIndex: invalidStep.index,
          action: invalidStep.action,
        },
        400,
      );
    }

    if (!sessionManager.resolveTargetSession(sessionId)) {
      const msg = sessionId
        ? `Chrome extension session "${sessionId}" is not connected`
        : 'Chrome extension is not connected';
      logger.http(`POST /api/v2/batch — ${msg}`);
      return c.json({ error: msg }, 503);
    }

    const summary = await executeBatchSteps(sessionManager, steps, stopOnError, sessionId);
    return c.json(summary);
  });

  app.get('/api/v2/workflows', (c) => {
    return c.json({
      workflows: workflowStore.list(),
    });
  });

  app.post('/api/v2/workflows', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }

    const parsed = WorkflowUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid workflow payload: "name" and non-empty "steps" array are required' },
        400,
      );
    }

    const invalidStep = findInvalidStep(parsed.data.steps);
    if (invalidStep) {
      return c.json(
        {
          error: invalidStep.error,
          stepIndex: invalidStep.index,
          action: invalidStep.action,
        },
        400,
      );
    }

    const { workflow, created } = workflowStore.save(parsed.data);
    return c.json({ workflow }, created ? 201 : 200);
  });

  app.delete('/api/v2/workflows/:id', (c) => {
    const id = c.req.param('id');
    const deleted = workflowStore.delete(id);
    if (!deleted) {
      return c.json({ error: `Workflow "${id}" not found` }, 404);
    }
    return c.json({ deleted: true });
  });

  app.post('/api/v2/workflows/:id/run', async (c) => {
    const id = c.req.param('id');
    const workflow = workflowStore.get(id);
    if (!workflow) {
      return c.json({ error: `Workflow "${id}" not found` }, 404);
    }

    let body: unknown = {};
    const rawText = await c.req.text();
    if (rawText.trim().length > 0) {
      try {
        body = JSON.parse(rawText);
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }

    const parsed = WorkflowRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid workflow run options' }, 400);
    }

    const violation = findPolicyViolation(workflow.steps, securityConfig);
    if (violation) {
      logger.warn(
        `Policy rejected workflow "${id}" step #${violation.index} (${violation.action}): ${violation.reason}`,
      );
      return c.json(
        {
          error: violation.reason,
          stepIndex: violation.index,
          action: violation.action,
        },
        403,
      );
    }

    const { sessionId, stopOnError = true } = parsed.data;
    if (!sessionManager.resolveTargetSession(sessionId)) {
      const msg = sessionId
        ? `Chrome extension session "${sessionId}" is not connected`
        : 'Chrome extension is not connected';
      return c.json({ error: msg }, 503);
    }

    const summary = await executeBatchSteps(sessionManager, workflow.steps, stopOnError, sessionId);

    return c.json({
      workflowId: workflow.id,
      ...summary,
    });
  });

  app.get('/api/v2/events', (c) => {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const safeEnqueue = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };

        const closeStream = () => {
          if (closed) return;
          cleanup();
          try {
            controller.close();
          } catch {
            // Stream already closed
          }
        };

        // Initial snapshot event
        safeEnqueue(
          formatSseMessage('snapshot', {
            sessions: sessionManager.listSessions(),
            traces: traceStore.list(),
          }),
        );

        unsubscribe = eventBus.subscribe((event) => {
          safeEnqueue(formatSseMessage(event.type, event.data));
        }, closeStream);

        heartbeatTimer = setInterval(() => {
          safeEnqueue(': heartbeat\n\n');
        }, 15_000);
        heartbeatTimer.unref?.();

        c.req.raw.signal.addEventListener('abort', closeStream, { once: true });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
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

import type {
  BatchStep,
  SavedWorkflow,
  SessionSummary,
  SnapshotElement,
  TraceEntry,
} from '@antigravity-bridge/protocol';

export const AUTH_TOKEN_STORAGE_KEY = 'agb_dashboard_auth_token';

export interface StatusResponse {
  connected: boolean;
  pendingCommands: number;
  uptime: number;
  sessionsCount: number;
  sessions: SessionSummary[];
}

export interface CommandExecutionResponse {
  success: boolean;
  id: string;
  result: Record<string, unknown>;
}

export interface WorkflowRunResponse {
  workflowId: string;
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  results: Array<{
    index: number;
    action: string;
    success: boolean;
    id?: string;
    durationMs: number;
    result?: Record<string, unknown>;
    error?: string;
  }>;
}

export function buildAuthHeaders(
  token?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const trimmed = token?.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

export function loadStoredAuthToken(storage?: Pick<Storage, 'getItem'>): string {
  try {
    return storage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveStoredAuthToken(token: string, storage?: Pick<Storage, 'setItem'>): void {
  try {
    storage?.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function parseJsonParams(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Params must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function parseWorkflowSteps(raw: string): BatchStep[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Workflow steps must be a non-empty JSON array');
  }
  return parsed.map((step, index) => {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      throw new Error(`Step #${index + 1} must be an object`);
    }
    const candidate = step as Record<string, unknown>;
    if (typeof candidate.action !== 'string' || candidate.action.trim().length === 0) {
      throw new Error(`Step #${index + 1} is missing a valid "action"`);
    }
    return {
      action: candidate.action.trim(),
      ...(typeof candidate.params === 'object' &&
      candidate.params !== null &&
      !Array.isArray(candidate.params)
        ? { params: candidate.params as Record<string, unknown> }
        : {}),
      ...(typeof candidate.delayMs === 'number' && Number.isFinite(candidate.delayMs)
        ? { delayMs: Math.max(0, Math.floor(candidate.delayMs)) }
        : {}),
    };
  });
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatUptime(connectedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - connectedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTraceTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour12: false });
}

export function extractImageDataUrl(result: Record<string, unknown> | undefined): string | null {
  if (!result) return null;
  const candidate = result.image ?? result.screenshot ?? result.dataUrl;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null;
  }
  const trimmed = candidate.trim();
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
}

export function extractSnapshotElements(
  result: Record<string, unknown> | undefined,
): SnapshotElement[] {
  if (!result || !Array.isArray(result.elements)) {
    return [];
  }

  const out: SnapshotElement[] = [];
  for (const item of result.elements) {
    if (typeof item !== 'object' || item === null) continue;
    const el = item as Record<string, unknown>;
    if (typeof el.ref !== 'string') continue;
    out.push({
      ref: el.ref,
      role: typeof el.role === 'string' ? el.role : 'element',
      tagName: typeof el.tagName === 'string' ? el.tagName : 'div',
      label: typeof el.label === 'string' ? el.label : '',
      text: typeof el.text === 'string' ? el.text : '',
      visible: typeof el.visible === 'boolean' ? el.visible : true,
      rect:
        typeof el.rect === 'object' && el.rect !== null
          ? (el.rect as SnapshotElement['rect'])
          : { x: 0, y: 0, width: 0, height: 0 },
      ...(typeof el.value === 'string' ? { value: el.value } : {}),
      ...(typeof el.placeholder === 'string' ? { placeholder: el.placeholder } : {}),
      ...(typeof el.href === 'string' ? { href: el.href } : {}),
    });
  }
  return out;
}

export function prependTrace(traces: TraceEntry[], next: TraceEntry, maxSize = 100): TraceEntry[] {
  const filtered = traces.filter((t) => t.id !== next.id);
  return [next, ...filtered].slice(0, maxSize);
}

export class DashboardApiClient {
  constructor(
    private readonly baseUrl = '',
    private readonly getToken: () => string = () => '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: buildAuthHeaders(this.getToken(), {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  getStatus(): Promise<StatusResponse> {
    return this.requestJson<StatusResponse>('/status');
  }

  getTraces(limit = 50): Promise<{ traces: TraceEntry[]; count: number }> {
    return this.requestJson<{ traces: TraceEntry[]; count: number }>(
      `/api/v2/traces?limit=${limit}`,
    );
  }

  runCommand(
    action: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<CommandExecutionResponse> {
    return this.requestJson<CommandExecutionResponse>('/command', {
      method: 'POST',
      body: JSON.stringify({
        action,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    });
  }

  listWorkflows(): Promise<{ workflows: SavedWorkflow[] }> {
    return this.requestJson<{ workflows: SavedWorkflow[] }>('/api/v2/workflows');
  }

  saveWorkflow(payload: {
    id?: string;
    name: string;
    description?: string;
    steps: BatchStep[];
  }): Promise<{ workflow: SavedWorkflow }> {
    return this.requestJson<{ workflow: SavedWorkflow }>('/api/v2/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  deleteWorkflow(id: string): Promise<{ deleted: boolean }> {
    return this.requestJson<{ deleted: boolean }>(`/api/v2/workflows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  runWorkflow(
    id: string,
    options: { sessionId?: string; stopOnError?: boolean } = {},
  ): Promise<WorkflowRunResponse> {
    return this.requestJson<WorkflowRunResponse>(
      `/api/v2/workflows/${encodeURIComponent(id)}/run`,
      {
        method: 'POST',
        body: JSON.stringify(options),
      },
    );
  }
}

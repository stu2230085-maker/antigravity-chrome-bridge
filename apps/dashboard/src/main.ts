import type { SavedWorkflow, SessionSummary, TraceEntry } from '@antigravity-bridge/protocol';
import {
  buildEventsUrl,
  DashboardApiClient,
  extractImageDataUrl,
  extractSnapshotElements,
  formatDuration,
  formatTraceTime,
  formatUptime,
  loadStoredAuthToken,
  parseJsonParams,
  parseWorkflowSteps,
  prependTrace,
  saveStoredAuthToken,
} from './api.js';

interface DashboardState {
  sessions: SessionSummary[];
  traces: TraceEntry[];
  workflows: SavedWorkflow[];
  selectedSessionId: string;
  authToken: string;
  serverConnected: boolean;
  sseConnected: boolean;
}

const state: DashboardState = {
  sessions: [],
  traces: [],
  workflows: [],
  selectedSessionId: '',
  authToken: loadStoredAuthToken(typeof localStorage !== 'undefined' ? localStorage : undefined),
  serverConnected: false,
  sseConnected: false,
};

const api = new DashboardApiClient('', () => state.authToken);

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing DOM element #${id}`);
  }
  return el as T;
}

const serverStatusPill = byId<HTMLSpanElement>('serverStatusPill');
const serverStatusText = byId<HTMLSpanElement>('serverStatusText');
const sseStatusPill = byId<HTMLSpanElement>('sseStatusPill');
const sseStatusText = byId<HTMLSpanElement>('sseStatusText');
const sessionSelect = byId<HTMLSelectElement>('sessionSelect');
const authTokenInput = byId<HTMLInputElement>('authTokenInput');
const sessionCountBadge = byId<HTMLSpanElement>('sessionCountBadge');
const sessionsGrid = byId<HTMLDivElement>('sessionsGrid');
const commandStatusBadge = byId<HTMLSpanElement>('commandStatusBadge');
const navigateUrlInput = byId<HTMLInputElement>('navigateUrlInput');
const customCommandForm = byId<HTMLFormElement>('customCommandForm');
const customActionInput = byId<HTMLInputElement>('customActionInput');
const customParamsInput = byId<HTMLInputElement>('customParamsInput');
const snapshotCount = byId<HTMLSpanElement>('snapshotCount');
const snapshotTableBody = byId<HTMLTableSectionElement>('snapshotTableBody');
const previewMeta = byId<HTMLSpanElement>('previewMeta');
const previewFrame = byId<HTMLDivElement>('previewFrame');
const commandOutputPre = byId<HTMLPreElement>('commandOutputPre');
const workflowCountBadge = byId<HTMLSpanElement>('workflowCountBadge');
const workflowsList = byId<HTMLDivElement>('workflowsList');
const createWorkflowForm = byId<HTMLFormElement>('createWorkflowForm');
const workflowNameInput = byId<HTMLInputElement>('workflowNameInput');
const workflowDescInput = byId<HTMLInputElement>('workflowDescInput');
const workflowStepsInput = byId<HTMLTextAreaElement>('workflowStepsInput');
const workflowFormMsg = byId<HTMLSpanElement>('workflowFormMsg');
const traceCountBadge = byId<HTMLSpanElement>('traceCountBadge');
const tracesTableBody = byId<HTMLTableSectionElement>('tracesTableBody');

authTokenInput.value = state.authToken;

function renderStatusHeader(): void {
  serverStatusPill.className = `pill ${state.serverConnected ? 'pill-ok' : 'pill-warn'}`;
  serverStatusText.textContent = state.serverConnected
    ? `Bridge Online (${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'})`
    : 'Bridge Waiting';

  sseStatusPill.className = `pill ${state.sseConnected ? 'pill-ok' : 'pill-warn'}`;
  sseStatusText.textContent = state.sseConnected ? 'SSE: Live' : 'SSE: Polling';
}

function renderSessions(): void {
  const prevSelection = state.selectedSessionId;
  sessionSelect.replaceChildren();
  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  autoOpt.textContent = 'auto (default)';
  sessionSelect.appendChild(autoOpt);

  for (const session of state.sessions) {
    const opt = document.createElement('option');
    opt.value = session.sessionId;
    opt.textContent = `${session.profile} (${session.sessionId.slice(0, 14)})`;
    sessionSelect.appendChild(opt);
  }
  sessionSelect.value = state.sessions.some((s) => s.sessionId === prevSelection)
    ? prevSelection
    : '';
  state.selectedSessionId = sessionSelect.value;

  sessionCountBadge.textContent = `${state.sessions.length} active`;
  sessionsGrid.replaceChildren();

  if (state.sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Waiting for Chrome extension connection…';
    sessionsGrid.appendChild(empty);
    return;
  }

  for (const session of state.sessions) {
    const card = document.createElement('article');
    card.className = `session-card${session.active ? ' is-active' : ''}`;

    const head = document.createElement('div');
    head.className = 'session-card-head';

    const title = document.createElement('span');
    title.className = 'session-profile';
    title.textContent = session.profile || 'default';

    const badge = document.createElement('span');
    badge.className = `badge ${session.active ? 'badge-ok' : 'badge-muted'}`;
    badge.textContent = session.active ? 'Active Group' : 'Connected';

    head.append(title, badge);

    const meta = document.createElement('div');
    meta.className = 'session-meta';

    const rows: Array<[string, string]> = [
      ['Session ID', session.sessionId],
      ['Version', session.version ?? 'v2.0'],
      ['Uptime', formatUptime(session.connectedAt)],
      ['Last Seen', formatTraceTime(session.lastSeenAt)],
    ];

    for (const [label, value] of rows) {
      const k = document.createElement('span');
      k.className = 'muted';
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'mono truncate';
      v.textContent = value;
      meta.append(k, v);
    }

    card.append(head, meta);
    sessionsGrid.appendChild(card);
  }
}

function renderTraces(): void {
  traceCountBadge.textContent = `${state.traces.length} trace${state.traces.length === 1 ? '' : 's'}`;
  tracesTableBody.replaceChildren();

  if (state.traces.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-cell';
    td.textContent = 'No command traces recorded yet';
    tr.appendChild(td);
    tracesTableBody.appendChild(tr);
    return;
  }

  for (const trace of state.traces) {
    const tr = document.createElement('tr');

    const timeTd = document.createElement('td');
    timeTd.className = 'mono';
    timeTd.textContent = formatTraceTime(trace.startedAt);

    const actionTd = document.createElement('td');
    actionTd.className = 'mono';
    actionTd.textContent = trace.action;

    const sessionTd = document.createElement('td');
    sessionTd.className = 'mono truncate';
    sessionTd.textContent = trace.sessionId;

    const durationTd = document.createElement('td');
    durationTd.className = 'mono';
    durationTd.textContent = formatDuration(trace.durationMs);

    const statusTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `badge ${trace.success ? 'badge-ok' : 'badge-err'}`;
    pill.textContent = trace.success ? 'OK' : `ERR: ${trace.error ?? 'failed'}`;
    statusTd.appendChild(pill);

    tr.append(timeTd, actionTd, sessionTd, durationTd, statusTd);
    tracesTableBody.appendChild(tr);
  }
}

function renderSnapshotElements(result: Record<string, unknown>): void {
  const elements = extractSnapshotElements(result);
  snapshotCount.textContent = `${elements.length} element${elements.length === 1 ? '' : 's'}`;
  snapshotTableBody.replaceChildren();

  if (elements.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty-cell';
    td.textContent = 'No interactive snapshot elements in latest result';
    tr.appendChild(td);
    snapshotTableBody.appendChild(tr);
    return;
  }

  for (const el of elements) {
    const tr = document.createElement('tr');

    const refTd = document.createElement('td');
    refTd.className = 'mono';
    refTd.textContent = el.ref;

    const roleTd = document.createElement('td');
    roleTd.className = 'mono';
    roleTd.textContent = `${el.role} <${el.tagName}>`;

    const labelTd = document.createElement('td');
    labelTd.className = 'truncate';
    labelTd.textContent = el.label || el.text || el.placeholder || el.href || '—';

    const actionTd = document.createElement('td');
    const clickBtn = document.createElement('button');
    clickBtn.type = 'button';
    clickBtn.className = 'btn btn-sm btn-primary';
    clickBtn.textContent = `Click ${el.ref}`;
    clickBtn.addEventListener('click', () => {
      void executeStudioCommand('click', { ref: el.ref });
    });
    actionTd.appendChild(clickBtn);

    tr.append(refTd, roleTd, labelTd, actionTd);
    snapshotTableBody.appendChild(tr);
  }
}

function renderCommandOutput(action: string, payload: unknown, ok: boolean): void {
  commandStatusBadge.className = `badge ${ok ? 'badge-ok' : 'badge-err'}`;
  commandStatusBadge.textContent = ok ? `${action} • OK` : `${action} • Failed`;
  commandOutputPre.textContent = JSON.stringify(payload, null, 2);

  const resultRecord =
    typeof payload === 'object' && payload !== null && 'result' in payload
      ? ((payload as { result?: Record<string, unknown> }).result ?? undefined)
      : undefined;

  if (resultRecord) {
    if (Array.isArray(resultRecord.elements)) {
      renderSnapshotElements(resultRecord);
    }

    const imgUrl = extractImageDataUrl(resultRecord);
    if (imgUrl) {
      previewFrame.replaceChildren();
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = `${action} preview`;
      previewFrame.appendChild(img);
      previewMeta.textContent = `${action} @ ${formatTraceTime(Date.now())}`;
    }
  }
}

async function executeStudioCommand(
  action: string,
  params: Record<string, unknown>,
): Promise<void> {
  commandStatusBadge.className = 'badge';
  commandStatusBadge.textContent = `Running ${action}…`;

  try {
    const response = await api.runCommand(action, params, state.selectedSessionId || undefined);
    renderCommandOutput(action, response, response.result.success !== false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderCommandOutput(action, { error: message }, false);
  }
}

function renderWorkflows(): void {
  workflowCountBadge.textContent = `${state.workflows.length} saved`;
  workflowsList.replaceChildren();

  if (state.workflows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No saved workflows yet';
    workflowsList.appendChild(empty);
    return;
  }

  for (const wf of state.workflows) {
    const card = document.createElement('div');
    card.className = 'workflow-card';

    const head = document.createElement('div');
    head.className = 'workflow-card-head';

    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = wf.name;
    const count = document.createElement('span');
    count.className = 'muted';
    count.textContent = ` • ${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}`;
    info.append(name, count);

    const actions = document.createElement('div');
    actions.className = 'workflow-card-actions';

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'btn btn-sm btn-primary';
    runBtn.textContent = 'Run';
    runBtn.addEventListener('click', async () => {
      commandStatusBadge.className = 'badge';
      commandStatusBadge.textContent = `Running workflow ${wf.name}…`;
      try {
        const res = await api.runWorkflow(wf.id, {
          ...(state.selectedSessionId ? { sessionId: state.selectedSessionId } : {}),
        });
        renderCommandOutput(`workflow:${wf.name}`, res, res.success);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        renderCommandOutput(`workflow:${wf.name}`, { error: message }, false);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      try {
        await api.deleteWorkflow(wf.id);
        await refreshWorkflows();
      } catch (err) {
        workflowFormMsg.textContent = err instanceof Error ? err.message : String(err);
      }
    });

    actions.append(runBtn, delBtn);
    head.append(info, actions);
    card.appendChild(head);

    if (wf.description) {
      const desc = document.createElement('div');
      desc.className = 'muted';
      desc.textContent = wf.description;
      card.appendChild(desc);
    }

    workflowsList.appendChild(card);
  }
}

async function refreshSnapshotPolling(): Promise<void> {
  try {
    const [status, tracesRes] = await Promise.all([api.getStatus(), api.getTraces(50)]);
    state.serverConnected = status.connected;
    state.sessions = status.sessions;
    state.traces = tracesRes.traces;
    renderStatusHeader();
    renderSessions();
    renderTraces();
  } catch {
    state.serverConnected = false;
    renderStatusHeader();
  }
}

async function refreshWorkflows(): Promise<void> {
  try {
    const { workflows } = await api.listWorkflows();
    state.workflows = workflows;
    renderWorkflows();
  } catch {
    // Keep existing workflows list if request fails transiently
  }
}

let activeEventSource: EventSource | null = null;

function connectSse(): void {
  if (typeof EventSource === 'undefined') {
    return;
  }

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  const es = new EventSource(buildEventsUrl('', state.authToken));
  activeEventSource = es;

  es.onopen = () => {
    state.sseConnected = true;
    renderStatusHeader();
  };

  es.onerror = () => {
    state.sseConnected = false;
    renderStatusHeader();
  };

  es.addEventListener('snapshot', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as {
        sessions?: SessionSummary[];
        traces?: TraceEntry[];
      };
      if (Array.isArray(payload.sessions)) {
        state.sessions = payload.sessions;
        state.serverConnected = payload.sessions.length > 0;
        renderSessions();
      }
      if (Array.isArray(payload.traces)) {
        state.traces = payload.traces;
        renderTraces();
      }
      state.sseConnected = true;
      renderStatusHeader();
    } catch {
      // Ignore malformed SSE payload
    }
  });

  es.addEventListener('sessions', (ev) => {
    try {
      const sessions = JSON.parse((ev as MessageEvent<string>).data) as SessionSummary[];
      state.sessions = sessions;
      state.serverConnected = sessions.length > 0;
      renderSessions();
      renderStatusHeader();
    } catch {
      // Ignore malformed SSE payload
    }
  });

  es.addEventListener('trace', (ev) => {
    try {
      const trace = JSON.parse((ev as MessageEvent<string>).data) as TraceEntry;
      state.traces = prependTrace(state.traces, trace, 100);
      renderTraces();
    } catch {
      // Ignore malformed SSE payload
    }
  });
}

sessionSelect.addEventListener('change', () => {
  state.selectedSessionId = sessionSelect.value;
});

authTokenInput.addEventListener('input', () => {
  state.authToken = authTokenInput.value;
  saveStoredAuthToken(
    state.authToken,
    typeof localStorage !== 'undefined' ? localStorage : undefined,
  );
  connectSse();
  void refreshSnapshotPolling();
  void refreshWorkflows();
});

byId<HTMLButtonElement>('btnNavigate').addEventListener('click', () => {
  const url = navigateUrlInput.value.trim();
  if (url) {
    void executeStudioCommand('navigate', { url });
  }
});

byId<HTMLButtonElement>('btnSnapshotOverlay').addEventListener('click', () => {
  void executeStudioCommand('snapshot', { interactiveOnly: true, overlay: true });
});

byId<HTMLButtonElement>('btnScreenshotViewport').addEventListener('click', () => {
  void executeStudioCommand('screenshot', { fullPage: false });
});

byId<HTMLButtonElement>('btnScreenshotFull').addEventListener('click', () => {
  void executeStudioCommand('screenshot', { fullPage: true });
});

byId<HTMLButtonElement>('btnConsoleLogs').addEventListener('click', () => {
  void executeStudioCommand('get_console_logs', {});
});

byId<HTMLButtonElement>('btnNetworkLogs').addEventListener('click', () => {
  void executeStudioCommand('get_network_logs', {});
});

customCommandForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const action = customActionInput.value.trim();
  if (!action) return;
  try {
    const params = parseJsonParams(customParamsInput.value);
    void executeStudioCommand(action, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderCommandOutput(action, { error: message }, false);
  }
});

createWorkflowForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  workflowFormMsg.textContent = '';

  const name = workflowNameInput.value.trim();
  const description = workflowDescInput.value.trim();
  if (!name) return;

  try {
    const steps = parseWorkflowSteps(workflowStepsInput.value);
    await api.saveWorkflow({
      name,
      ...(description ? { description } : {}),
      steps,
    });
    workflowNameInput.value = '';
    workflowDescInput.value = '';
    workflowFormMsg.textContent = 'Workflow saved';
    await refreshWorkflows();
  } catch (err) {
    workflowFormMsg.textContent = err instanceof Error ? err.message : String(err);
  }
});

void refreshSnapshotPolling();
void refreshWorkflows();
connectSse();

setInterval(() => {
  if (!state.sseConnected) {
    void refreshSnapshotPolling();
  }
}, 5000);

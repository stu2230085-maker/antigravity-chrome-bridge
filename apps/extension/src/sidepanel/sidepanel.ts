import type { CommandFeedItem, ExportFormat, RecordedStep } from '../recorder/types.js';

interface StatusPayload {
  connected?: boolean;
  groupId?: number | null;
  profileName?: string;
  sessionId?: string | null;
}

interface RecorderPayload {
  ok?: boolean;
  isRecording?: boolean;
  recordingTabId?: number | null;
  steps?: RecordedStep[];
  error?: string;
}

interface CommandFeedPayload {
  ok?: boolean;
  history?: CommandFeedItem[];
}

interface ExportPayload {
  ok?: boolean;
  format?: ExportFormat;
  code?: string;
}

function $<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing DOM element: ${selector}`);
  return el;
}

const statusPill = $<HTMLDivElement>('#statusPill');
const statusText = $<HTMLSpanElement>('#statusText');
const profileMeta = $<HTMLSpanElement>('#profileMeta');
const sessionMeta = $<HTMLSpanElement>('#sessionMeta');

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

const btnSnapOverlay = $<HTMLButtonElement>('#btnSnapOverlay');
const btnClearMarks = $<HTMLButtonElement>('#btnClearMarks');
const feedFeedback = $<HTMLDivElement>('#feedFeedback');
const feedCount = $<HTMLSpanElement>('#feedCount');
const feedList = $<HTMLUListElement>('#feedList');

const recIndicator = $<HTMLSpanElement>('#recIndicator');
const btnRecordStart = $<HTMLButtonElement>('#btnRecordStart');
const btnRecordStop = $<HTMLButtonElement>('#btnRecordStop');
const btnRecordClear = $<HTMLButtonElement>('#btnRecordClear');
const stepCount = $<HTMLSpanElement>('#stepCount');
const stepList = $<HTMLOListElement>('#stepList');
const exportFormatSelect = $<HTMLSelectElement>('#exportFormat');
const exportPreview = $<HTMLTextAreaElement>('#exportPreview');
const btnCopyCode = $<HTMLButtonElement>('#btnCopyCode');
const copyStatus = $<HTMLSpanElement>('#copyStatus');

const runnerActionSelect = $<HTMLSelectElement>('#runnerAction');
const runnerInputGroup = $<HTMLDivElement>('#runnerInputGroup');
const runnerInputLabel = $<HTMLLabelElement>('#runnerInputLabel');
const runnerInput = $<HTMLTextAreaElement>('#runnerInput');
const btnRunQuick = $<HTMLButtonElement>('#btnRunQuick');
const runnerStatus = $<HTMLSpanElement>('#runnerStatus');
const runnerOutput = $<HTMLPreElement>('#runnerOutput');

let currentSteps: RecordedStep[] = [];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function describeStep(step: RecordedStep): string {
  switch (step.action) {
    case 'navigate':
      return step.url ?? '';
    case 'click':
      return step.selector ?? '';
    case 'type':
      return `${step.selector ?? ''} ← "${step.text ?? ''}"`;
    case 'select':
      return `${step.selector ?? ''} = "${step.value ?? ''}"`;
    case 'press_key':
      return step.selector ? `${step.key ?? ''} (${step.selector})` : (step.key ?? '');
  }
}

function updateStatusUI(status?: StatusPayload): void {
  const connected = Boolean(status?.connected);
  statusPill.className = `status-pill ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? '接続中' : '未接続';
  profileMeta.textContent = `Profile: ${status?.profileName || 'default'}`;
  sessionMeta.textContent = `Session: ${status?.sessionId ? status.sessionId.slice(0, 16) : '-'}`;
}

function renderCommandFeed(history: CommandFeedItem[]): void {
  feedCount.textContent = String(history.length);
  feedList.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '実行されたコマンドはここに表示されます';
    feedList.appendChild(empty);
    return;
  }

  for (const item of history) {
    const li = document.createElement('li');
    li.className = 'feed-item';

    const top = document.createElement('div');
    top.className = 'feed-item-top';

    const actionSpan = document.createElement('span');
    actionSpan.className = 'feed-action';
    actionSpan.textContent = item.action;

    const statusBadge = document.createElement('span');
    statusBadge.className = item.success ? 'badge-ok' : 'badge-err';
    statusBadge.textContent = item.success
      ? `OK · ${item.durationMs}ms`
      : `ERR · ${item.durationMs}ms`;

    top.append(actionSpan, statusBadge);

    const meta = document.createElement('div');
    meta.className = 'feed-meta';
    meta.textContent = `${formatTime(item.timestamp)} · ${item.source ?? 'ws'}${item.error ? ` · ${item.error}` : ''}`;

    li.append(top, meta);
    feedList.appendChild(li);
  }
}

function refreshExportPreview(): void {
  const format = exportFormatSelect.value as ExportFormat;
  chrome.runtime.sendMessage(
    { type: 'recorder_export', format },
    (response: ExportPayload | undefined) => {
      if (chrome.runtime.lastError || !response?.ok) {
        exportPreview.value = '';
        return;
      }
      exportPreview.value = response.code ?? '';
    },
  );
}

function renderRecorderState(state?: RecorderPayload): void {
  const isRecording = Boolean(state?.isRecording);
  currentSteps = Array.isArray(state?.steps) ? state.steps : [];

  recIndicator.textContent = isRecording ? 'REC ●' : 'IDLE';
  recIndicator.className = `rec-indicator ${isRecording ? 'active' : ''}`;
  btnRecordStart.disabled = isRecording;
  btnRecordStop.disabled = !isRecording;
  stepCount.textContent = String(currentSteps.length);

  stepList.replaceChildren();
  if (currentSteps.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '「Record」を押してブラウザ操作を記録してください';
    stepList.appendChild(empty);
  } else {
    currentSteps.forEach((step, idx) => {
      const li = document.createElement('li');
      li.className = 'step-item';

      const top = document.createElement('div');
      top.className = 'step-item-top';

      const actionEl = document.createElement('span');
      actionEl.className = 'step-action';
      actionEl.textContent = `#${idx + 1} ${step.action}`;

      const timeEl = document.createElement('span');
      timeEl.className = 'feed-meta';
      timeEl.textContent = formatTime(step.timestamp);

      top.append(actionEl, timeEl);

      const detail = document.createElement('div');
      detail.className = 'step-detail';
      detail.textContent = describeStep(step);

      li.append(top, detail);
      stepList.appendChild(li);
    });
  }

  refreshExportPreview();
}

function switchTab(tabName: string): void {
  for (const btn of tabButtons) {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const panel of tabPanels) {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  }
}

function syncRunnerInputs(): void {
  const action = runnerActionSelect.value;
  if (action === 'snapshot') {
    runnerInputGroup.style.display = 'none';
  } else if (action === 'navigate') {
    runnerInputGroup.style.display = 'flex';
    runnerInputLabel.textContent = 'Target URL';
    runnerInput.placeholder = 'https://example.com';
    if (!runnerInput.value.trim()) {
      runnerInput.value = 'https://example.com';
    }
  } else {
    runnerInputGroup.style.display = 'flex';
    runnerInputLabel.textContent = 'JavaScript Expression';
    runnerInput.placeholder = 'document.title';
    if (!runnerInput.value.trim() || runnerInput.value.trim().startsWith('http')) {
      runnerInput.value = 'document.title';
    }
  }
}

function runBridgeCommand(
  action: string,
  params: Record<string, unknown>,
  onDone: (res: Record<string, unknown>) => void,
): void {
  chrome.runtime.sendMessage(
    { type: 'run_command', action, params },
    (response: Record<string, unknown> | undefined) => {
      if (chrome.runtime.lastError) {
        onDone({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      onDone(response ?? { success: false, error: 'No response from background' });
    },
  );
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab) {
      switchTab(btn.dataset.tab);
    }
  });
}

btnSnapOverlay.addEventListener('click', () => {
  btnSnapOverlay.disabled = true;
  feedFeedback.textContent = 'Capturing AI Snapshot...';
  runBridgeCommand('snapshot', { interactiveOnly: true, markOverlay: true }, (res) => {
    btnSnapOverlay.disabled = false;
    if (res.success === false) {
      feedFeedback.textContent = `Snapshot failed: ${String(res.error ?? 'Unknown error')}`;
    } else {
      feedFeedback.textContent = `Snapshot captured (${String(res.count ?? 0)} refs marked)`;
    }
  });
});

btnClearMarks.addEventListener('click', () => {
  btnClearMarks.disabled = true;
  runBridgeCommand('clear_marks', {}, (res) => {
    btnClearMarks.disabled = false;
    feedFeedback.textContent =
      res.success === false
        ? `Clear failed: ${String(res.error ?? 'Unknown error')}`
        : 'Overlay marks cleared';
  });
});

btnRecordStart.addEventListener('click', () => {
  chrome.runtime.sendMessage(
    { type: 'recorder_start' },
    (response: RecorderPayload | undefined) => {
      if (chrome.runtime.lastError) {
        recIndicator.textContent = 'ERROR';
        return;
      }
      if (response?.ok) {
        renderRecorderState(response);
      }
    },
  );
});

btnRecordStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'recorder_stop' }, (response: RecorderPayload | undefined) => {
    if (!chrome.runtime.lastError && response?.ok) {
      renderRecorderState(response);
    }
  });
});

btnRecordClear.addEventListener('click', () => {
  chrome.runtime.sendMessage(
    { type: 'recorder_clear' },
    (response: RecorderPayload | undefined) => {
      if (!chrome.runtime.lastError && response?.ok) {
        renderRecorderState(response);
      }
    },
  );
});

exportFormatSelect.addEventListener('change', () => {
  refreshExportPreview();
});

btnCopyCode.addEventListener('click', () => {
  const text = exportPreview.value;
  if (!text) return;
  void navigator.clipboard.writeText(text).then(() => {
    copyStatus.textContent = 'Copied!';
    setTimeout(() => {
      copyStatus.textContent = '';
    }, 1800);
  });
});

runnerActionSelect.addEventListener('change', syncRunnerInputs);

btnRunQuick.addEventListener('click', () => {
  const action = runnerActionSelect.value;
  const rawInput = runnerInput.value.trim();

  let params: Record<string, unknown> = {};
  if (action === 'navigate') {
    if (!rawInput) {
      runnerOutput.textContent = 'Please enter a URL.';
      return;
    }
    params = { url: rawInput };
  } else if (action === 'snapshot') {
    params = { interactiveOnly: true, markOverlay: false };
  } else if (action === 'evaluate') {
    if (!rawInput) {
      runnerOutput.textContent = 'Please enter JavaScript code.';
      return;
    }
    params = { code: rawInput };
  }

  btnRunQuick.disabled = true;
  runnerStatus.textContent = 'Running...';

  runBridgeCommand(action, params, (res) => {
    btnRunQuick.disabled = false;
    runnerStatus.textContent = res.success === false ? 'Failed' : 'Success';
    runnerOutput.textContent = JSON.stringify(res, null, 2);
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: {
      type?: string;
      history?: CommandFeedItem[];
      isRecording?: boolean;
      recordingTabId?: number | null;
      steps?: RecordedStep[];
    } & StatusPayload,
  ) => {
    if (message.type === 'status_update') {
      updateStatusUI(message);
    } else if (message.type === 'command_feed_update' && Array.isArray(message.history)) {
      renderCommandFeed(message.history);
    } else if (message.type === 'recorder_update') {
      renderRecorderState(message);
    }
  },
);

function init(): void {
  syncRunnerInputs();

  chrome.runtime.sendMessage({ type: 'get_status' }, (response: StatusPayload | undefined) => {
    if (!chrome.runtime.lastError) {
      updateStatusUI(response);
    }
  });

  chrome.runtime.sendMessage(
    { type: 'get_command_feed' },
    (response: CommandFeedPayload | undefined) => {
      if (!chrome.runtime.lastError && Array.isArray(response?.history)) {
        renderCommandFeed(response.history);
      }
    },
  );

  chrome.runtime.sendMessage(
    { type: 'recorder_get_state' },
    (response: RecorderPayload | undefined) => {
      if (!chrome.runtime.lastError && response?.ok) {
        renderRecorderState(response);
      }
    },
  );
}

init();

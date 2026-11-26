import { KEEPALIVE_ALARM_NAME } from '@antigravity-bridge/protocol';
import { ensureTelemetryListeners } from '../engines/cdp/telemetry.js';
import { executeCommand } from '../engines/scripting/index.js';
import { recorderManager } from '../recorder/recorder-manager.js';
import type { ExportFormat, RecordedStep } from '../recorder/types.js';
import { WsClient } from './ws-client.js';

ensureTelemetryListeners();
const wsClient = new WsClient();

function isExportFormat(value: unknown): value is ExportFormat {
  return value === 'batch_json' || value === 'cli_script' || value === 'sdk_code';
}

function isRecordedStep(value: unknown): value is RecordedStep {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timestamp === 'number' &&
    (candidate.action === 'navigate' ||
      candidate.action === 'click' ||
      candidate.action === 'type' ||
      candidate.action === 'select' ||
      candidate.action === 'press_key')
  );
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    void wsClient.handleKeepaliveAlarm();
  }
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    recorderManager.handleTabUpdated(tabId, changeInfo.url, tab.title);
  }
  if (changeInfo.status === 'complete') {
    void recorderManager.reinjectOnNavigation(tabId);
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  const state = recorderManager.getState();
  if (state.isRecording && state.recordingTabId === tabId) {
    void recorderManager.stopRecording();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'get_status') {
    void wsClient.getStoredSettings().then(() => {
      sendResponse(wsClient.getStatus());
    });
    return true;
  }

  if (message.type === 'connect') {
    const updates: Record<string, string> = {};
    if (typeof message.serverUrl === 'string' && message.serverUrl.trim()) {
      updates.serverUrl = message.serverUrl.trim();
    }
    if (typeof message.profileName === 'string' && message.profileName.trim()) {
      updates.profileName = message.profileName.trim();
    }

    const savePromise =
      Object.keys(updates).length > 0 ? chrome.storage.local.set(updates) : Promise.resolve();

    void savePromise.then(async () => {
      await wsClient.connect(true);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'disconnect') {
    wsClient.disconnect();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'update_server_url') {
    if (typeof message.serverUrl === 'string' && message.serverUrl.trim()) {
      void chrome.storage.local.set({ serverUrl: message.serverUrl.trim() }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }

  if (message.type === 'update_profile_name') {
    if (typeof message.profileName === 'string' && message.profileName.trim()) {
      void chrome.storage.local.set({ profileName: message.profileName.trim() }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }

  if (message.type === 'recorder_start') {
    const tabId = typeof message.tabId === 'number' ? message.tabId : undefined;
    void recorderManager
      .startRecording(tabId)
      .then((state) => {
        sendResponse({ ok: true, ...state });
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: errorMsg });
      });
    return true;
  }

  if (message.type === 'recorder_stop') {
    void recorderManager.stopRecording().then((state) => {
      sendResponse({ ok: true, ...state });
    });
    return true;
  }

  if (message.type === 'recorder_clear') {
    const state = recorderManager.clearSteps();
    sendResponse({ ok: true, ...state });
    return true;
  }

  if (message.type === 'recorder_get_state') {
    sendResponse({ ok: true, ...recorderManager.getState() });
    return true;
  }

  if (message.type === 'recorder_event') {
    if (!isRecordedStep(message.step)) {
      sendResponse({ ok: false, error: 'Invalid recorded step payload' });
      return true;
    }
    const state = recorderManager.addStep(message.step);
    sendResponse({ ok: true, ...state });
    return true;
  }

  if (message.type === 'recorder_export') {
    const format: ExportFormat = isExportFormat(message.format) ? message.format : 'batch_json';
    const name =
      typeof message.name === 'string' && message.name.trim() ? message.name.trim() : undefined;
    const code = recorderManager.exportSteps(format, name);
    sendResponse({ ok: true, format, code });
    return true;
  }

  if (message.type === 'get_command_feed') {
    sendResponse({ ok: true, history: recorderManager.getCommandHistory() });
    return true;
  }

  if (message.type === 'run_command') {
    if (typeof message.action !== 'string' || !message.action.trim()) {
      sendResponse({ success: false, error: 'Missing command action' });
      return true;
    }
    const commandId = `sp-${Date.now()}`;
    const action = message.action;
    const params =
      message.params && typeof message.params === 'object' && !Array.isArray(message.params)
        ? (message.params as Record<string, unknown>)
        : {};
    const startedAt = Date.now();

    void executeCommand({ id: commandId, action, params })
      .then((result) => {
        recorderManager.recordCommandExecution({
          id: commandId,
          action,
          success: result.success !== false,
          durationMs: Date.now() - startedAt,
          timestamp: Date.now(),
          ...(typeof result.error === 'string' ? { error: result.error } : {}),
          source: 'sidepanel',
        });
        sendResponse(result);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        recorderManager.recordCommandExecution({
          id: commandId,
          action,
          success: false,
          durationMs: Date.now() - startedAt,
          timestamp: Date.now(),
          error: errorMsg,
          source: 'sidepanel',
        });
        sendResponse({ success: false, error: errorMsg });
      });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  void wsClient.ensureKeepaliveAlarm();
  void wsClient.connect(true);
});

chrome.runtime.onStartup.addListener(() => {
  void wsClient.ensureKeepaliveAlarm();
  void wsClient.connect(true);
});

void wsClient.ensureKeepaliveAlarm();
void wsClient.connect();

console.log('[Antigravity INFO] Antigravity Chrome Bridge v2.0 service worker started');

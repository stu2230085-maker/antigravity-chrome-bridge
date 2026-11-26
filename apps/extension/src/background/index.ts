import { KEEPALIVE_ALARM_NAME } from '@antigravity-bridge/protocol';
import { ensureTelemetryListeners } from '../engines/cdp/telemetry.js';
import { WsClient } from './ws-client.js';

ensureTelemetryListeners();
const wsClient = new WsClient();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    void wsClient.handleKeepaliveAlarm();
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

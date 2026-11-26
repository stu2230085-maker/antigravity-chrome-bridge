import { DEFAULT_WS_URL } from '@antigravity-bridge/protocol';

interface StatusPayload {
  connected?: boolean;
  groupId?: number | null;
  profileName?: string;
}

function $<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing DOM element: ${sel}`);
  return el;
}

const statusCard = $<HTMLDivElement>('#statusCard');
const statusDot = $<HTMLDivElement>('#statusDot');
const statusLabel = $<HTMLSpanElement>('#statusLabel');
const statusDetails = $<HTMLDivElement>('#statusDetails');
const profileBadge = $<HTMLDivElement>('#profileBadge');
const serverUrlInput = $<HTMLInputElement>('#serverUrl');
const profileNameInput = $<HTMLInputElement>('#profileName');
const connectBtn = $<HTMLButtonElement>('#connectBtn');
const disconnectBtn = $<HTMLButtonElement>('#disconnectBtn');
const openSidePanelBtn = $<HTMLButtonElement>('#openSidePanelBtn');
const groupInfo = $<HTMLDivElement>('#groupInfo');
const groupText = $<HTMLParagraphElement>('#groupText');

let currentWindowId: number | undefined;

function updateUI(status?: StatusPayload): void {
  const connected = Boolean(status?.connected);

  statusCard.className = `status-card ${connected ? 'connected' : 'disconnected'}`;
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusLabel.textContent = connected ? '接続中' : '未接続';
  statusDetails.textContent = connected
    ? 'サーバーに接続済み'
    : 'ブリッジサーバーに接続していません';

  if (status?.profileName) {
    profileBadge.style.display = 'block';
    profileBadge.textContent = `プロファイル: ${status.profileName}`;
  } else {
    profileBadge.style.display = 'none';
  }

  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;

  if (status?.groupId) {
    groupInfo.style.display = 'block';
    groupText.textContent = `グループID: ${status.groupId}`;
  } else {
    groupInfo.style.display = connected ? 'block' : 'none';
    groupText.textContent = '操作開始時に自動作成されます';
  }
}

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: 'get_status' }, (response: StatusPayload | undefined) => {
    if (chrome.runtime.lastError) {
      updateUI({ connected: false });
      return;
    }
    updateUI(response);
  });
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get({
    serverUrl: DEFAULT_WS_URL,
    profileName: 'default',
  });
  serverUrlInput.value =
    typeof stored.serverUrl === 'string' && stored.serverUrl ? stored.serverUrl : DEFAULT_WS_URL;
  profileNameInput.value =
    typeof stored.profileName === 'string' && stored.profileName ? stored.profileName : 'default';

  try {
    const win = await chrome.windows?.getCurrent();
    currentWindowId = win?.id;
  } catch {
    currentWindowId = undefined;
  }

  refreshStatus();
}

connectBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  if (!url) {
    serverUrlInput.focus();
    return;
  }
  const profileName = profileNameInput.value.trim() || 'default';

  connectBtn.disabled = true;
  connectBtn.textContent = '接続中...';

  chrome.runtime.sendMessage(
    {
      type: 'connect',
      serverUrl: url,
      profileName,
    },
    () => {
      setTimeout(refreshStatus, 1000);
      setTimeout(() => {
        connectBtn.textContent = '接続';
      }, 1200);
    },
  );
});

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' }, () => {
    setTimeout(refreshStatus, 300);
  });
});

openSidePanelBtn.addEventListener('click', () => {
  if (chrome.sidePanel?.open && currentWindowId !== undefined) {
    void chrome.sidePanel.open({ windowId: currentWindowId });
    return;
  }
  chrome.windows?.getCurrent((win) => {
    if (win?.id !== undefined && chrome.sidePanel?.open) {
      void chrome.sidePanel.open({ windowId: win.id });
    } else {
      chrome.runtime.sendMessage({ type: 'open_side_panel', windowId: win?.id });
    }
  });
});

serverUrlInput.addEventListener('change', () => {
  const url = serverUrlInput.value.trim();
  if (url) {
    chrome.runtime.sendMessage({ type: 'update_server_url', serverUrl: url });
  }
});

profileNameInput.addEventListener('change', () => {
  const profileName = profileNameInput.value.trim() || 'default';
  chrome.runtime.sendMessage({ type: 'update_profile_name', profileName });
});

chrome.runtime.onMessage.addListener((message: { type?: string } & StatusPayload) => {
  if (message.type === 'status_update') {
    updateUI(message);
  }
});

void init();

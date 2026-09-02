// ============================================================
// Antigravity Chrome Bridge — Popup Script
// ============================================================

const $ = (sel) => document.querySelector(sel);

// DOM elements
const statusCard = $('#statusCard');
const statusDot = $('#statusDot');
const statusLabel = $('#statusLabel');
const statusDetails = $('#statusDetails');
const serverUrlInput = $('#serverUrl');
const connectBtn = $('#connectBtn');
const disconnectBtn = $('#disconnectBtn');
const groupInfo = $('#groupInfo');
const groupText = $('#groupText');

// ---- Initialize ----

async function init() {
  // Load saved server URL
  const stored = await chrome.storage.local.get({ serverUrl: 'ws://localhost:8767' });
  serverUrlInput.value = stored.serverUrl;

  // Get current status
  refreshStatus();
}

// ---- Status ----

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    if (chrome.runtime.lastError) {
      updateUI({ connected: false });
      return;
    }
    updateUI(response);
  });
}

function updateUI(status) {
  const connected = status?.connected || false;

  // Status card
  statusCard.className = `status-card ${connected ? 'connected' : 'disconnected'}`;
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusLabel.textContent = connected ? '接続中' : '未接続';
  statusDetails.textContent = connected
    ? `サーバーに接続済み`
    : 'ブリッジサーバーに接続していません';

  // Buttons
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;

  // Tab group info
  if (status?.groupId) {
    groupInfo.style.display = 'block';
    groupText.textContent = `グループID: ${status.groupId}`;
  } else {
    groupInfo.style.display = connected ? 'block' : 'none';
    groupText.textContent = '操作開始時に自動作成されます';
  }
}

// ---- Events ----

connectBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  if (!url) {
    serverUrlInput.focus();
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = '接続中...';

  chrome.runtime.sendMessage({
    type: 'connect',
    serverUrl: url,
  }, () => {
    // Wait a moment for connection to establish
    setTimeout(refreshStatus, 1000);
    setTimeout(() => {
      connectBtn.textContent = '接続';
    }, 1200);
  });
});

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' }, () => {
    setTimeout(refreshStatus, 300);
  });
});

serverUrlInput.addEventListener('change', () => {
  const url = serverUrlInput.value.trim();
  if (url) {
    chrome.runtime.sendMessage({ type: 'update_server_url', serverUrl: url });
  }
});

// Listen for real-time status updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'status_update') {
    updateUI(message);
  }
});

// ---- Start ----
init();

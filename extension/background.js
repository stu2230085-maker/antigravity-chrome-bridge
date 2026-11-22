// ============================================================
// Antigravity Chrome Bridge — Background Service Worker
// ============================================================
// Connects to the local bridge server via WebSocket, receives
// commands, executes them using Chrome APIs, and returns results.
// Manages a dedicated tab group for all Antigravity-controlled tabs.
// ============================================================

// --------------- Configuration ---------------
const DEFAULT_WS_URL = 'ws://localhost:8767';
const KEEPALIVE_INTERVAL_MS = 20000;
const RECONNECT_DELAY_MS = 3000;
const TAB_GROUP_TITLE = '🤖 Antigravity';
const TAB_GROUP_COLOR = 'blue';

// --------------- State ---------------
let ws = null;
let isConnected = false;
let keepaliveTimer = null;
let reconnectTimer = null;
let antigravityGroupId = null;

// --------------- Logging ---------------
function log(level, ...args) {
  const prefix = `[Antigravity ${level}]`;
  if (level === 'ERROR') console.error(prefix, ...args);
  else if (level === 'WARN') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

// ============================================================
// WebSocket Connection Management
// ============================================================

async function getServerUrl() {
  const result = await chrome.storage.local.get({ serverUrl: DEFAULT_WS_URL });
  return result.serverUrl;
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = await getServerUrl();
  log('INFO', `Connecting to ${url}...`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    log('ERROR', 'Failed to create WebSocket:', err.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    log('INFO', 'Connected to bridge server ✓');
    isConnected = true;
    clearReconnectTimer();
    startKeepalive();
    broadcastStatus();
  };

  ws.onmessage = async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (err) {
      log('ERROR', 'Invalid JSON received:', event.data);
      return;
    }

    // Ignore keepalive acknowledgments
    if (message.type === 'keepalive_ack' || message.type === 'keepalive') {
      return;
    }

    // Process command
    if (message.id && message.action) {
      log('INFO', `Command received: [${message.id}] ${message.action}`);
      let result;
      try {
        result = await executeCommand(message);
        log('INFO', `Command completed: [${message.id}] ${message.action}`);
      } catch (err) {
        log('ERROR', `Command failed: [${message.id}]`, err.message);
        result = { success: false, error: err.message };
      }

      // Send result back
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: message.id, ...result }));
      }
    }
  };

  ws.onclose = (event) => {
    log('WARN', `Disconnected (code: ${event.code})`);
    isConnected = false;
    stopKeepalive();
    broadcastStatus();
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    log('ERROR', 'WebSocket error');
    // onclose will fire after this
  };
}

function disconnect() {
  clearReconnectTimer();
  stopKeepalive();
  if (ws) {
    ws.onclose = null; // Prevent auto-reconnect
    ws.close();
    ws = null;
  }
  isConnected = false;
  broadcastStatus();
  log('INFO', 'Disconnected manually');
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'keepalive', timestamp: Date.now() }));
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => connect(), RECONNECT_DELAY_MS);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ============================================================
// Tab Group Management
// ============================================================

/**
 * Find or create the Antigravity tab group.
 * Returns the group ID.
 */
async function ensureTabGroup() {
  // Try to find existing group
  if (antigravityGroupId !== null) {
    try {
      const group = await chrome.tabGroups.get(antigravityGroupId);
      if (group) return antigravityGroupId;
    } catch {
      // Group was closed, reset
      antigravityGroupId = null;
    }
  }

  // Search for existing group by title
  const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE });
  if (groups.length > 0) {
    antigravityGroupId = groups[0].id;
    return antigravityGroupId;
  }

  // Create a new tab inside a new group
  const tab = await chrome.tabs.create({ active: false });
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, {
    title: TAB_GROUP_TITLE,
    color: TAB_GROUP_COLOR,
    collapsed: false
  });

  antigravityGroupId = groupId;
  log('INFO', `Tab group created: "${TAB_GROUP_TITLE}" (id: ${groupId})`);
  return groupId;
}

/**
 * Add a tab to the Antigravity tab group.
 */
async function addTabToGroup(tabId) {
  const groupId = await ensureTabGroup();
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
  } catch (err) {
    log('WARN', `Could not add tab ${tabId} to group:`, err.message);
  }
}

/**
 * Get or create a tab in the Antigravity group.
 * If the group already has tabs, returns the active one.
 * Otherwise creates a new tab in the group.
 */
async function getOrCreateGroupTab() {
  const groupId = await ensureTabGroup();

  // Find tabs in the group
  const allTabs = await chrome.tabs.query({});
  const groupTabs = allTabs.filter(t => t.groupId === groupId);

  if (groupTabs.length > 0) {
    // Return the first non-newtab tab, or the first tab
    const usableTab = groupTabs.find(t => !t.url?.startsWith('chrome://newtab')) || groupTabs[0];
    return usableTab;
  }

  // Create a new tab in the group
  const tab = await chrome.tabs.create({ active: false });
  await addTabToGroup(tab.id);
  return tab;
}

// ============================================================
// Command Execution
// ============================================================

async function executeCommand(command) {
  const { action, params = {} } = command;

  switch (action) {
    case 'navigate':
      return await cmdNavigate(params);
    case 'click':
      return await cmdClick(params);
    case 'type':
      return await cmdType(params);
    case 'scroll':
      return await cmdScroll(params);
    case 'screenshot':
      return await cmdScreenshot(params);
    case 'get_content':
      return await cmdGetContent(params);
    case 'get_text':
      return await cmdGetText(params);
    case 'get_tabs':
      return await cmdGetTabs();
    case 'evaluate':
      return await cmdEvaluate(params);
    case 'get_elements':
      return await cmdGetElements(params);
    case 'wait_for':
      return await cmdWaitFor(params);
    case 'new_tab':
      return await cmdNewTab(params);
    case 'close_tab':
      return await cmdCloseTab(params);
    case 'switch_tab':
      return await cmdSwitchTab(params);
    case 'hover':
      return await cmdHover(params);
    case 'click_at':
      return await cmdClickAt(params);
    case 'select':
      return await cmdSelect(params);
    case 'get_url':
      return await cmdGetUrl(params);
    case 'go_back':
      return await cmdGoBack(params);
    case 'go_forward':
      return await cmdGoForward(params);
    case 'reload':
      return await cmdReload(params);
    case 'iframe_click_at':
      return await cmdIframeClickAt(params);
    case 'iframe_get_elements':
      return await cmdIframeGetElements(params);
    case 'iframe_get_text':
      return await cmdIframeGetText(params);
    case 'iframe_click':
      return await cmdIframeClick(params);
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

// --------------- Find target iframe frameId ---------------
async function findTargetFrameId(tabId, frameUrl) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (frameUrl) {
    const matched = frames.find(f => f.frameId !== 0 && f.url && f.url.includes(frameUrl));
    if (matched) return matched.frameId;
  }
  // Fallback: find the first non-main frame with a real URL
  const nonMain = frames.find(f => f.frameId !== 0 && f.url && !f.url.startsWith('about:'));
  return nonMain ? nonMain.frameId : null;
}

// --- Iframe Click At (coordinates) ---
async function cmdIframeClickAt(params) {
  const { x, y, frameUrl } = params;
  if (x === undefined || y === undefined) return { success: false, error: 'Missing parameters: x, y' };

  const tab = await resolveTab(params);
  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (clickX, clickY) => {
      const el = document.elementFromPoint(clickX, clickY);
      if (!el) return { found: false, error: `No element at (${clickX}, ${clickY})` };
      
      // Use setTimeout to avoid blocking if the event handler is slow/sync
      setTimeout(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: clickX, clientY: clickY }));
      }, 10);

      return { found: true, tagName: el.tagName, id: el.id || '', className: el.className || '', x: clickX, y: clickY };
    },
    args: [x, y]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Click at failed' };
  return { success: true, ...result };
}

// --- Iframe Get Elements ---
async function cmdIframeGetElements(params) {
  const { selector, limit = 30, frameUrl } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel, lim) => {
      const elements = Array.from(document.querySelectorAll(sel)).slice(0, lim);
      return elements.map((el, i) => {
        const rect = el.getBoundingClientRect();
        return {
          index: i,
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          text: (el.innerText || '').slice(0, 200),
          href: el.href || null,
          value: el.value || null,
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      });
    },
    args: [selector, limit]
  });

  const elements = results[0]?.result || [];
  return { success: true, count: elements.length, elements };
}

// --- Iframe Get Text ---
async function cmdIframeGetText(params) {
  const { selector, frameUrl } = params;

  const tab = await resolveTab(params);
  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, text: el.innerText };
      }
      return { found: true, text: document.body?.innerText || '' };
    },
    args: [selector || null]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Get text failed' };
  return { success: true, ...result };
}

// --- Iframe Click (by selector) ---
async function cmdIframeClick(params) {
  const { selector, frameUrl } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      return { found: true, tagName: el.tagName, text: (el.textContent || '').slice(0, 100) };
    },
    args: [selector]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Click failed' };
  return { success: true, ...result };
}

// --------------- Resolve target tab ---------------

async function resolveTab(params) {
  if (params.tabId) {
    return await chrome.tabs.get(params.tabId);
  }
  // Default: use a tab inside the Antigravity group
  return await getOrCreateGroupTab();
}

// --------------- Wait for tab to finish loading ---------------

function waitForTabLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Don't fail, just proceed
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ============================================================
// Command Implementations
// ============================================================

// --- Navigate ---
async function cmdNavigate(params) {
  const { url } = params;
  if (!url) return { success: false, error: 'Missing parameter: url' };

  const tab = await resolveTab(params);
  await chrome.tabs.update(tab.id, { url, active: true });
  await addTabToGroup(tab.id);
  await waitForTabLoad(tab.id);

  return { success: true, tabId: tab.id, url };
}

// --- Click ---
async function cmdClick(params) {
  const { selector, allFrames = false } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };

      // Scroll element into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Brief highlight effect
      const origOutline = el.style.outline;
      el.style.outline = '3px solid #4285f4';
      setTimeout(() => { el.style.outline = origOutline; }, 500);

      el.click();
      return { found: true, tagName: el.tagName, text: el.textContent?.slice(0, 100), frameUrl: location.href };
    },
    args: [selector]
  });

  // With allFrames, find the first frame that found the element
  const result = results.find(r => r.result?.found)?.result || results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Click failed' };
  return { success: true, ...result };
}

// --- Type ---
async function cmdType(params) {
  const { selector, text, clear = true, allFrames = false } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };
  if (text === undefined) return { success: false, error: 'Missing parameter: text' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel, txt, shouldClear) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };

      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (shouldClear) {
        // Use native setter for React/Vue/Angular compatibility
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(el), 'value'
        );
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, txt);
        } else {
          el.value = txt;
        }
      } else {
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(el), 'value'
        );
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, el.value + txt);
        } else {
          el.value += txt;
        }
      }

      // Dispatch events for framework compatibility
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return { found: true, tagName: el.tagName };
    },
    args: [selector, text, clear]
  });

  const result = results.find(r => r.result?.found)?.result || results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Type failed' };
  return { success: true, ...result };
}

// --- Scroll ---
async function cmdScroll(params) {
  const { x = 0, y = 0, selector, direction, amount = 500, allFrames = false } = params;

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (scrollX, scrollY, sel, dir, amt) => {
      let target = window;

      if (sel) {
        const el = document.querySelector(sel);
        if (!el) return { success: false, error: `Element not found: ${sel}` };
        target = el;
      }

      if (dir) {
        const scrollMap = {
          up:    { left: 0, top: -amt },
          down:  { left: 0, top: amt },
          left:  { left: -amt, top: 0 },
          right: { left: amt, top: 0 },
        };
        const scroll = scrollMap[dir.toLowerCase()];
        if (!scroll) return { success: false, error: `Invalid direction: ${dir}` };
        target.scrollBy({ ...scroll, behavior: 'smooth' });
      } else {
        target.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
      }

      return {
        success: true,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      };
    },
    args: [x, y, selector || null, direction || null, amount]
  });

  return results[0]?.result || { success: false, error: 'Scroll failed' };
}

// --- Screenshot ---
async function cmdScreenshot(params) {
  const tab = await resolveTab(params);
  // Ensure tab is active for captureVisibleTab
  await chrome.tabs.update(tab.id, { active: true });
  // Small delay for rendering
  await new Promise(r => setTimeout(r, 200));

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: params.format || 'png',
    quality: params.quality || 80
  });

  return { success: true, image: dataUrl, tabId: tab.id };
}

// --- Get Content (HTML) ---
async function cmdGetContent(params) {
  const { selector, allFrames = false } = params;
  const tab = await resolveTab(params);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, html: el.outerHTML, url: location.href, title: document.title };
      }
      return { found: true, html: document.documentElement.outerHTML, url: location.href, title: document.title };
    },
    args: [selector || null]
  });

  // With allFrames, return all frames' content
  if (allFrames) {
    const allResults = results.filter(r => r.result?.found).map(r => r.result);
    return { success: true, frames: allResults, count: allResults.length };
  }
  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Get content failed' };
  return { success: true, ...result };
}

// --- Get Text ---
async function cmdGetText(params) {
  const { selector, allFrames = false } = params;
  const tab = await resolveTab(params);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, text: el.innerText, url: location.href, title: document.title };
      }
      return { found: true, text: document.body?.innerText || '', url: location.href, title: document.title };
    },
    args: [selector || null]
  });

  // With allFrames, return all frames' text
  if (allFrames) {
    const allResults = results.filter(r => r.result?.found).map(r => r.result);
    return { success: true, frames: allResults, count: allResults.length };
  }
  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Get text failed' };
  return { success: true, ...result };
}

// --- Get Tabs ---
async function cmdGetTabs() {
  const allTabs = await chrome.tabs.query({});
  const groupTabs = antigravityGroupId
    ? allTabs.filter(t => t.groupId === antigravityGroupId)
    : [];

  const mapTab = t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
    inGroup: t.groupId === antigravityGroupId,
    status: t.status,
  });

  return {
    success: true,
    groupTabs: groupTabs.map(mapTab),
    allTabs: allTabs.map(mapTab),
    groupId: antigravityGroupId,
  };
}

// --- Evaluate JavaScript ---
async function cmdEvaluate(params) {
  const { code } = params;
  if (!code) return { success: false, error: 'Missing parameter: code' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: new Function('return (async () => { ' + code + ' })()'),
  });

  return { success: true, result: results[0]?.result };
}

// --- Get Elements ---
async function cmdGetElements(params) {
  const { selector, limit = 20, allFrames = false } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel, lim) => {
      const elements = Array.from(document.querySelectorAll(sel)).slice(0, lim);
      return {
        frameUrl: location.href,
        elements: elements.map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            text: el.innerText?.slice(0, 200) || '',
            href: el.href || null,
            src: el.src || null,
            value: el.value || null,
            type: el.type || null,
            placeholder: el.placeholder || null,
            visible: rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        })
      };
    },
    args: [selector, limit]
  });

  // With allFrames, merge results from all frames
  if (allFrames) {
    const allElements = [];
    const frameInfo = [];
    for (const r of results) {
      if (r.result?.elements?.length > 0) {
        frameInfo.push({ frameUrl: r.result.frameUrl, count: r.result.elements.length });
        allElements.push(...r.result.elements);
      }
    }
    return { success: true, count: allElements.length, elements: allElements, frames: frameInfo };
  }

  const elements = results[0]?.result?.elements || [];
  return { success: true, count: elements.length, elements };
}

// --- Wait For Element ---
async function cmdWaitFor(params) {
  const { selector, timeout = 10000 } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, ms) => {
      return new Promise((resolve) => {
        const existing = document.querySelector(sel);
        if (existing) {
          resolve({ found: true, waited: 0 });
          return;
        }

        const start = Date.now();
        const observer = new MutationObserver(() => {
          const el = document.querySelector(sel);
          if (el) {
            observer.disconnect();
            resolve({ found: true, waited: Date.now() - start });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
          observer.disconnect();
          resolve({ found: false, error: `Timeout waiting for: ${sel}` });
        }, ms);
      });
    },
    args: [selector, timeout]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Wait failed' };
  return { success: true, ...result };
}

// --- New Tab ---
async function cmdNewTab(params) {
  const { url } = params;
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  await addTabToGroup(tab.id);
  if (url) await waitForTabLoad(tab.id);
  return { success: true, tabId: tab.id, url: tab.url };
}

// --- Close Tab ---
async function cmdCloseTab(params) {
  const tab = await resolveTab(params);
  await chrome.tabs.remove(tab.id);
  return { success: true, closedTabId: tab.id };
}

// --- Switch Tab ---
async function cmdSwitchTab(params) {
  const { tabId } = params;
  if (!tabId) return { success: false, error: 'Missing parameter: tabId' };
  await chrome.tabs.update(tabId, { active: true });
  return { success: true, tabId };
}

// --- Hover ---
async function cmdHover(params) {
  const { selector, allFrames = false } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      // Highlight effect
      const origOutline = el.style.outline;
      el.style.outline = '2px dashed #fbbc04';
      setTimeout(() => { el.style.outline = origOutline; }, 800);

      return { found: true, tagName: el.tagName };
    },
    args: [selector]
  });

  const result = results.find(r => r.result?.found)?.result || results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Hover failed' };
  return { success: true, ...result };
}

// --- Click At (coordinates) ---
async function cmdClickAt(params) {
  const { x, y, allFrames = false } = params;
  if (x === undefined || y === undefined) return { success: false, error: 'Missing parameters: x, y' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (clickX, clickY) => {
      const el = document.elementFromPoint(clickX, clickY);
      if (!el) return { found: false, error: `No element at (${clickX}, ${clickY})` };
      
      // Use setTimeout to avoid blocking if the event handler is slow/sync
      setTimeout(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: clickX, clientY: clickY }));
      }, 10);

      return { found: true, tagName: el.tagName, id: el.id || '', className: el.className || '', x: clickX, y: clickY };
    },
    args: [x, y]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Click at failed' };
  return { success: true, ...result };
}

// --- Select (dropdown) ---
async function cmdSelect(params) {
  const { selector, value } = params;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };
  if (value === undefined) return { success: false, error: 'Missing parameter: value' };

  const tab = await resolveTab(params);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };
      if (el.tagName !== 'SELECT') return { found: false, error: 'Element is not a <select>' };

      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, selectedValue: el.value };
    },
    args: [selector, value]
  });

  const result = results[0]?.result;
  if (!result?.found) return { success: false, error: result?.error || 'Select failed' };
  return { success: true, ...result };
}

// --- Get URL ---
async function cmdGetUrl(params) {
  const tab = await resolveTab(params);
  return { success: true, url: tab.url, title: tab.title, tabId: tab.id };
}

// --- Go Back ---
async function cmdGoBack(params) {
  const tab = await resolveTab(params);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => history.back()
  });
  await new Promise(r => setTimeout(r, 500));
  return { success: true, tabId: tab.id };
}

// --- Go Forward ---
async function cmdGoForward(params) {
  const tab = await resolveTab(params);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => history.forward()
  });
  await new Promise(r => setTimeout(r, 500));
  return { success: true, tabId: tab.id };
}

// --- Reload ---
async function cmdReload(params) {
  const tab = await resolveTab(params);
  await chrome.tabs.reload(tab.id);
  await waitForTabLoad(tab.id);
  return { success: true, tabId: tab.id };
}

// ============================================================
// Status Broadcasting (to popup)
// ============================================================

function broadcastStatus() {
  const status = {
    type: 'status_update',
    connected: isConnected,
    groupId: antigravityGroupId,
  };

  chrome.runtime.sendMessage(status).catch(() => {
    // Popup may not be open — ignore
  });
}

// ============================================================
// Message Handler (from popup)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_status') {
    sendResponse({
      connected: isConnected,
      groupId: antigravityGroupId,
    });
    return true;
  }

  if (message.type === 'connect') {
    if (message.serverUrl) {
      chrome.storage.local.set({ serverUrl: message.serverUrl });
    }
    connect();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'update_server_url') {
    chrome.storage.local.set({ serverUrl: message.serverUrl });
    sendResponse({ ok: true });
    return true;
  }
});

// ============================================================
// Startup
// ============================================================

// Auto-connect on extension load
connect();

log('INFO', 'Antigravity Chrome Bridge service worker started');

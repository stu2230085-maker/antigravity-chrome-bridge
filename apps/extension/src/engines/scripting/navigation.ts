import {
  addTabToGroup,
  getCurrentGroupId,
  resolveTab,
  waitForTabLoad,
} from '../../background/tab-group.js';
import type { CommandResult } from './types.js';

export async function cmdNavigate(params: Record<string, unknown>): Promise<CommandResult> {
  const url = typeof params.url === 'string' ? params.url : undefined;
  if (!url) return { success: false, error: 'Missing parameter: url' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.tabs.update(tab.id, { url, active: true });
  await addTabToGroup(tab.id);
  await waitForTabLoad(tab.id);

  return { success: true, tabId: tab.id, url };
}

export async function cmdNewTab(params: Record<string, unknown>): Promise<CommandResult> {
  const url = typeof params.url === 'string' ? params.url : undefined;
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  if (tab.id === undefined) return { success: false, error: 'Created tab has no ID' };

  await addTabToGroup(tab.id);
  if (url) await waitForTabLoad(tab.id);
  return { success: true, tabId: tab.id, url: tab.url };
}

export async function cmdCloseTab(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.tabs.remove(tab.id);
  return { success: true, closedTabId: tab.id };
}

export async function cmdSwitchTab(params: Record<string, unknown>): Promise<CommandResult> {
  const tabId = typeof params.tabId === 'number' ? params.tabId : undefined;
  if (tabId === undefined) return { success: false, error: 'Missing parameter: tabId' };

  await chrome.tabs.update(tabId, { active: true });
  return { success: true, tabId };
}

export async function cmdGoBack(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => history.back(),
  });
  await new Promise((r) => setTimeout(r, 500));
  return { success: true, tabId: tab.id };
}

export async function cmdGoForward(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => history.forward(),
  });
  await new Promise((r) => setTimeout(r, 500));
  return { success: true, tabId: tab.id };
}

export async function cmdReload(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.tabs.reload(tab.id);
  await waitForTabLoad(tab.id);
  return { success: true, tabId: tab.id };
}

export async function cmdGetUrl(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  return { success: true, url: tab.url, title: tab.title, tabId: tab.id };
}

export async function cmdGetTabs(): Promise<CommandResult> {
  const allTabs = await chrome.tabs.query({});
  const groupId = getCurrentGroupId();
  const groupTabs = groupId !== null ? allTabs.filter((t) => t.groupId === groupId) : [];

  const mapTab = (t: chrome.tabs.Tab) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
    inGroup: groupId !== null && t.groupId === groupId,
    status: t.status,
  });

  return {
    success: true,
    groupTabs: groupTabs.map(mapTab),
    allTabs: allTabs.map(mapTab),
    groupId,
  };
}

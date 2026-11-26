import { TAB_GROUP_COLOR, TAB_GROUP_TITLE } from '@antigravity-bridge/protocol';

let antigravityGroupId: number | null = null;

export function getCurrentGroupId(): number | null {
  return antigravityGroupId;
}

export function resetGroupId(): void {
  antigravityGroupId = null;
}

export async function ensureTabGroup(): Promise<number> {
  if (antigravityGroupId !== null) {
    try {
      const group = await chrome.tabGroups.get(antigravityGroupId);
      if (group) return antigravityGroupId;
    } catch {
      antigravityGroupId = null;
    }
  }

  const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE });
  if (groups.length > 0 && groups[0]) {
    antigravityGroupId = groups[0].id;
    return antigravityGroupId;
  }

  const tab = await chrome.tabs.create({ active: false });
  if (tab.id === undefined) {
    throw new Error('Failed to create initial tab for Antigravity group');
  }
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, {
    title: TAB_GROUP_TITLE,
    color: TAB_GROUP_COLOR,
    collapsed: false,
  });

  antigravityGroupId = groupId;
  console.log(`[Antigravity INFO] Tab group created: "${TAB_GROUP_TITLE}" (id: ${groupId})`);
  return groupId;
}

export async function addTabToGroup(tabId: number): Promise<void> {
  const groupId = await ensureTabGroup();
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Antigravity WARN] Could not add tab ${tabId} to group:`, message);
  }
}

export async function getOrCreateGroupTab(): Promise<chrome.tabs.Tab> {
  const groupId = await ensureTabGroup();
  const allTabs = await chrome.tabs.query({});
  const groupTabs = allTabs.filter((t) => t.groupId === groupId);

  if (groupTabs.length > 0) {
    const usableTab = groupTabs.find((t) => !t.url?.startsWith('chrome://newtab')) ?? groupTabs[0];
    if (usableTab) return usableTab;
  }

  const tab = await chrome.tabs.create({ active: false });
  if (tab.id !== undefined) {
    await addTabToGroup(tab.id);
  }
  return tab;
}

export async function resolveTab(params: Record<string, unknown> = {}): Promise<chrome.tabs.Tab> {
  const tabId = typeof params.tabId === 'number' ? params.tabId : undefined;
  if (tabId !== undefined) {
    return await chrome.tabs.get(tabId);
  }
  return await getOrCreateGroupTab();
}

export function waitForTabLoad(tabId: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

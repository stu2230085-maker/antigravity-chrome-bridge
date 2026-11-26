import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from '../engines/scripting/index.js';

interface MockChrome {
  tabGroups: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tabs: {
    create: ReturnType<typeof vi.fn>;
    group: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    captureVisibleTab: ReturnType<typeof vi.fn>;
    onUpdated: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  webNavigation: {
    getAllFrames: ReturnType<typeof vi.fn>;
  };
}

function installMockChrome(): MockChrome {
  const mock: MockChrome = {
    tabGroups: {
      get: vi.fn(async () => ({ id: 99, title: '🤖 Antigravity' })),
      query: vi.fn(async () => [{ id: 99, title: '🤖 Antigravity' }]),
      update: vi.fn(async () => ({})),
    },
    tabs: {
      create: vi.fn(async ({ url }: { url?: string }) => ({
        id: 101,
        windowId: 1,
        groupId: 99,
        url: url ?? 'about:blank',
      })),
      group: vi.fn(async () => 99),
      query: vi.fn(async () => [
        {
          id: 101,
          windowId: 1,
          groupId: 99,
          url: 'https://example.com',
          title: 'Example',
          active: true,
          status: 'complete',
        },
      ]),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        windowId: 1,
        groupId: 99,
        url: 'https://example.com',
        title: 'Example',
      })),
      update: vi.fn(async (tabId: number, props: Record<string, unknown>) => ({
        id: tabId,
        ...props,
      })),
      remove: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      onUpdated: {
        addListener: vi.fn((listener: (tabId: number, info: { status?: string }) => void) => {
          setTimeout(() => listener(101, { status: 'complete' }), 0);
        }),
        removeListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: { found: true, text: 'hello' } }]),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => [
        { frameId: 0, url: 'https://example.com' },
        { frameId: 12, url: 'https://embed.example.com/widget' },
      ]),
    },
  };

  (globalThis as unknown as { chrome: MockChrome }).chrome = mock;
  return mock;
}

describe('@antigravity-bridge/extension command router', () => {
  let mockChrome: MockChrome;

  beforeEach(() => {
    mockChrome = installMockChrome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error for unknown action', async () => {
    const res = await executeCommand({ action: 'does_not_exist', params: {} });
    expect(res).toEqual({
      success: false,
      error: 'Unknown action: does_not_exist',
    });
  });

  it('returns error for invalid/missing action', async () => {
    const res = await executeCommand({ action: '', params: {} });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid command');
  });

  it('validates missing required parameters across commands', async () => {
    expect(await executeCommand({ action: 'navigate', params: {} })).toEqual({
      success: false,
      error: 'Missing parameter: url',
    });
    expect(await executeCommand({ action: 'click', params: {} })).toEqual({
      success: false,
      error: 'Missing parameter: selector',
    });
    expect(await executeCommand({ action: 'type', params: { selector: '#input' } })).toEqual({
      success: false,
      error: 'Missing parameter: text',
    });
    expect(await executeCommand({ action: 'click_at', params: { x: 10 } })).toEqual({
      success: false,
      error: 'Missing parameters: x, y',
    });
    expect(await executeCommand({ action: 'switch_tab', params: {} })).toEqual({
      success: false,
      error: 'Missing parameter: tabId',
    });
    expect(await executeCommand({ action: 'select', params: { selector: 'select' } })).toEqual({
      success: false,
      error: 'Missing parameter: value',
    });
    expect(await executeCommand({ action: 'evaluate', params: {} })).toEqual({
      success: false,
      error: 'Missing parameter: code',
    });
    expect(await executeCommand({ action: 'iframe_click_at', params: {} })).toEqual({
      success: false,
      error: 'Missing parameters: x, y',
    });
  });

  it('routes navigation, scripting, and iframe commands to mocked chrome APIs', async () => {
    const urlRes = await executeCommand({ action: 'get_url', params: {} });
    expect(urlRes).toMatchObject({
      success: true,
      url: 'https://example.com',
      tabId: 101,
    });

    const navRes = await executeCommand({
      action: 'navigate',
      params: { url: 'https://example.org' },
    });
    expect(navRes).toMatchObject({
      success: true,
      tabId: 101,
      url: 'https://example.org',
    });
    expect(mockChrome.tabs.update).toHaveBeenCalledWith(101, {
      url: 'https://example.org',
      active: true,
    });

    const tabsRes = await executeCommand({ action: 'get_tabs', params: {} });
    expect(tabsRes.success).toBe(true);
    expect(Array.isArray(tabsRes.allTabs)).toBe(true);

    const clickRes = await executeCommand({
      action: 'click',
      params: { selector: '#btn', allFrames: true },
    });
    expect(clickRes.success).toBe(true);
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 101, allFrames: true },
        args: ['#btn'],
      }),
    );

    const iframeRes = await executeCommand({
      action: 'iframe_get_text',
      params: { frameUrl: 'embed.example.com' },
    });
    expect(iframeRes).toMatchObject({ success: true, text: 'hello' });
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 101, frameIds: [12] },
      }),
    );

    const shotRes = await executeCommand({ action: 'screenshot', params: { format: 'png' } });
    expect(shotRes).toMatchObject({
      success: true,
      image: 'data:image/png;base64,AAAA',
      tabId: 101,
    });
  });
});

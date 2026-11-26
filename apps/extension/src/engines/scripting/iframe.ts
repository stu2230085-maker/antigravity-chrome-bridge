import { resolveTab } from '../../background/tab-group.js';
import type { CommandResult } from './types.js';

interface FoundOutcome {
  found: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function findTargetFrameId(tabId: number, frameUrl?: string): Promise<number | null> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  if (frameUrl) {
    const matched = frames.find((f) => f.frameId !== 0 && f.url && f.url.includes(frameUrl));
    if (matched) return matched.frameId;
  }
  const nonMain = frames.find((f) => f.frameId !== 0 && f.url && !f.url.startsWith('about:'));
  return nonMain ? nonMain.frameId : null;
}

export async function cmdIframeClickAt(params: Record<string, unknown>): Promise<CommandResult> {
  const x = typeof params.x === 'number' ? params.x : undefined;
  const y = typeof params.y === 'number' ? params.y : undefined;
  const frameUrl = typeof params.frameUrl === 'string' ? params.frameUrl : undefined;
  if (x === undefined || y === undefined) {
    return { success: false, error: 'Missing parameters: x, y' };
  }

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (clickX: number, clickY: number): FoundOutcome => {
      const el = document.elementFromPoint(clickX, clickY);
      if (!el) return { found: false, error: `No element at (${clickX}, ${clickY})` };

      setTimeout(() => {
        el.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY }),
        );
        el.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY }),
        );
        el.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: clickX, clientY: clickY }),
        );
      }, 10);

      return {
        found: true,
        tagName: el.tagName,
        id: el.id || '',
        className: el.className || '',
        x: clickX,
        y: clickY,
      };
    },
    args: [x, y],
  });

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Click at failed' };
  return { success: true, ...result };
}

export async function cmdIframeGetElements(
  params: Record<string, unknown>,
): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const limit = typeof params.limit === 'number' ? params.limit : 30;
  const frameUrl = typeof params.frameUrl === 'string' ? params.frameUrl : undefined;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel: string, lim: number) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(sel)).slice(0, lim);
      return elements.map((el, i) => {
        const rect = el.getBoundingClientRect();
        const inputLike = el as Partial<HTMLInputElement & HTMLAnchorElement>;
        return {
          index: i,
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          text: (el.innerText || '').slice(0, 200),
          href: inputLike.href || null,
          value: inputLike.value || null,
          visible: rect.width > 0 && rect.height > 0,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        };
      });
    },
    args: [selector, limit],
  });

  const elements = (results[0]?.result as Array<Record<string, unknown>> | undefined) || [];
  return { success: true, count: elements.length, elements };
}

export async function cmdIframeGetText(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : null;
  const frameUrl = typeof params.frameUrl === 'string' ? params.frameUrl : undefined;

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel: string | null): FoundOutcome => {
      if (sel) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, text: el.innerText };
      }
      return { found: true, text: document.body?.innerText || '' };
    },
    args: [selector],
  });

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Get text failed' };
  return { success: true, ...result };
}

export async function cmdIframeClick(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const frameUrl = typeof params.frameUrl === 'string' ? params.frameUrl : undefined;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const frameId = await findTargetFrameId(tab.id, frameUrl);
  if (frameId === null) return { success: false, error: 'Target iframe not found' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId] },
    func: (sel: string): FoundOutcome => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return { found: false, error: `Element not found: ${sel}` };
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      return {
        found: true,
        tagName: el.tagName,
        text: (el.textContent || '').slice(0, 100),
      };
    },
    args: [selector],
  });

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Click failed' };
  return { success: true, ...result };
}

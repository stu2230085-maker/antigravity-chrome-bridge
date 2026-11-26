import { resolveTab } from '../../background/tab-group.js';
import { cdpScreenshot } from '../cdp/actions.js';
import { resolveSelector } from '../snapshot/index.js';
import type { CommandResult } from './types.js';

interface FoundOutcome {
  found: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function cmdScreenshot(params: Record<string, unknown>): Promise<CommandResult> {
  if (params.fullPage || params.markOverlay || resolveSelector(params) || params.engine === 'cdp') {
    return await cdpScreenshot(params);
  }

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  await chrome.tabs.update(tab.id, { active: true });
  await new Promise((r) => setTimeout(r, 200));

  const format = params.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = typeof params.quality === 'number' ? params.quality : 80;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format,
    quality,
  });

  return { success: true, image: dataUrl, tabId: tab.id };
}

export async function cmdGetContent(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : null;
  const allFrames = Boolean(params.allFrames);

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel: string | null): FoundOutcome => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, html: el.outerHTML, url: location.href, title: document.title };
      }
      return {
        found: true,
        html: document.documentElement.outerHTML,
        url: location.href,
        title: document.title,
      };
    },
    args: [selector],
  });

  if (allFrames) {
    const allResults = results
      .map((r) => r.result as FoundOutcome | undefined)
      .filter((r): r is FoundOutcome => Boolean(r?.found));
    return { success: true, frames: allResults, count: allResults.length };
  }

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Get content failed' };
  return { success: true, ...result };
}

export async function cmdGetText(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : null;
  const allFrames = Boolean(params.allFrames);

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel: string | null): FoundOutcome => {
      if (sel) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return { found: false, error: `Element not found: ${sel}` };
        return { found: true, text: el.innerText, url: location.href, title: document.title };
      }
      return {
        found: true,
        text: document.body?.innerText || '',
        url: location.href,
        title: document.title,
      };
    },
    args: [selector],
  });

  if (allFrames) {
    const allResults = results
      .map((r) => r.result as FoundOutcome | undefined)
      .filter((r): r is FoundOutcome => Boolean(r?.found));
    return { success: true, frames: allResults, count: allResults.length };
  }

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Get text failed' };
  return { success: true, ...result };
}

export async function cmdGetElements(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const limit = typeof params.limit === 'number' ? params.limit : 20;
  const allFrames = Boolean(params.allFrames);
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel: string, lim: number) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(sel)).slice(0, lim);
      return {
        frameUrl: location.href,
        elements: elements.map((el, i) => {
          const rect = el.getBoundingClientRect();
          const inputLike = el as Partial<HTMLInputElement & HTMLAnchorElement>;
          return {
            index: i,
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            text: el.innerText?.slice(0, 200) || '',
            href: inputLike.href || null,
            src: (el as Partial<HTMLImageElement>).src || null,
            value: inputLike.value || null,
            type: inputLike.type || null,
            placeholder: inputLike.placeholder || null,
            visible: rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }),
      };
    },
    args: [selector, limit],
  });

  interface FrameElementsResult {
    frameUrl: string;
    elements: Array<Record<string, unknown>>;
  }

  if (allFrames) {
    const allElements: Array<Record<string, unknown>> = [];
    const frameInfo: Array<{ frameUrl: string; count: number }> = [];
    for (const r of results) {
      const res = r.result as FrameElementsResult | undefined;
      if (res?.elements && res.elements.length > 0) {
        frameInfo.push({ frameUrl: res.frameUrl, count: res.elements.length });
        allElements.push(...res.elements);
      }
    }
    return { success: true, count: allElements.length, elements: allElements, frames: frameInfo };
  }

  const first = results[0]?.result as FrameElementsResult | undefined;
  const elements = first?.elements || [];
  return { success: true, count: elements.length, elements };
}

export async function cmdEvaluate(params: Record<string, unknown>): Promise<CommandResult> {
  const code = typeof params.code === 'string' ? params.code : undefined;
  if (!code) return { success: false, error: 'Missing parameter: code' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const fn = new Function(`return (async () => { ${code} })()`) as () => unknown;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fn,
  });

  return { success: true, result: results[0]?.result };
}

export async function cmdWaitFor(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel: string, ms: number): Promise<FoundOutcome> => {
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
    args: [selector, timeout],
  });

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Wait failed' };
  return { success: true, ...result };
}

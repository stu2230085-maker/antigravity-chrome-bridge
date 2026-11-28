import { resolveTab } from '../../background/tab-group.js';
import { cdpClick, cdpType } from '../cdp/actions.js';
import { resolveSelector } from '../snapshot/index.js';
import type { CommandResult } from './types.js';

interface FoundOutcome {
  found: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function cmdClick(params: Record<string, unknown>): Promise<CommandResult> {
  if (params.engine === 'cdp') {
    return await cdpClick(params);
  }

  const selector = resolveSelector(params);
  const allFrames = Boolean(params.allFrames);
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const canFallbackToCdp =
    params.engine !== 'scripting' &&
    typeof chrome !== 'undefined' &&
    Boolean(chrome.debugger?.sendCommand);

  let results: Array<{ result?: unknown }>;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames },
      func: (sel: string): FoundOutcome => {
        const queryDeep = (root: Document | ShadowRoot, selectorStr: string): Element | null => {
          const direct = root.querySelector(selectorStr);
          if (direct) return direct;
          const hosts = root.querySelectorAll('*');
          for (const host of hosts) {
            if (host.shadowRoot) {
              const found = queryDeep(host.shadowRoot, selectorStr);
              if (found) return found;
            }
          }
          return null;
        };

        const el = queryDeep(document, sel) as HTMLElement | null;
        if (!el) return { found: false, error: `Element not found: ${sel}` };

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const origOutline = el.style.outline;
        el.style.outline = '3px solid #4285f4';
        setTimeout(() => {
          el.style.outline = origOutline;
        }, 500);

        el.click();
        return {
          found: true,
          tagName: el.tagName,
          text: el.textContent?.slice(0, 100),
          frameUrl: location.href,
        };
      },
      args: [selector],
    });
  } catch (err) {
    if (canFallbackToCdp) {
      return await cdpClick(params);
    }
    throw err;
  }

  const matched = results.find((r) => (r.result as FoundOutcome | undefined)?.found)?.result as
    | FoundOutcome
    | undefined;
  const result = matched ?? (results[0]?.result as FoundOutcome | undefined);
  if (!result?.found) {
    if (canFallbackToCdp) {
      return await cdpClick(params);
    }
    return { success: false, error: result?.error || 'Click failed' };
  }
  return { success: true, ...result };
}

export async function cmdClickAt(params: Record<string, unknown>): Promise<CommandResult> {
  const x = typeof params.x === 'number' ? params.x : undefined;
  const y = typeof params.y === 'number' ? params.y : undefined;
  const allFrames = Boolean(params.allFrames);
  if (x === undefined || y === undefined) {
    return { success: false, error: 'Missing parameters: x, y' };
  }

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
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

export async function cmdType(params: Record<string, unknown>): Promise<CommandResult> {
  if (params.engine === 'cdp') {
    return await cdpType(params);
  }

  const selector = resolveSelector(params);
  const text = params.text !== undefined ? String(params.text) : undefined;
  const clear = params.clear === undefined ? true : Boolean(params.clear);
  const allFrames = Boolean(params.allFrames);

  if (!selector) return { success: false, error: 'Missing parameter: selector' };
  if (text === undefined) return { success: false, error: 'Missing parameter: text' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const canFallbackToCdp =
    params.engine !== 'scripting' &&
    typeof chrome !== 'undefined' &&
    Boolean(chrome.debugger?.sendCommand);

  let results: Array<{ result?: unknown }>;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames },
      func: (sel: string, txt: string, shouldClear: boolean): FoundOutcome => {
        const queryDeep = (root: Document | ShadowRoot, selectorStr: string): Element | null => {
          const direct = root.querySelector(selectorStr);
          if (direct) return direct;
          const hosts = root.querySelectorAll('*');
          for (const host of hosts) {
            if (host.shadowRoot) {
              const found = queryDeep(host.shadowRoot, selectorStr);
              if (found) return found;
            }
          }
          return null;
        };

        const el = queryDeep(document, sel) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return { found: false, error: `Element not found: ${sel}` };

        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const nextValue = shouldClear ? txt : `${el.value}${txt}`;
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        if (descriptor?.set) {
          descriptor.set.call(el, nextValue);
        } else {
          el.value = nextValue;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { found: true, tagName: el.tagName };
      },
      args: [selector, text, clear],
    });
  } catch (err) {
    if (canFallbackToCdp) {
      return await cdpType(params);
    }
    throw err;
  }

  const matched = results.find((r) => (r.result as FoundOutcome | undefined)?.found)?.result as
    | FoundOutcome
    | undefined;
  const result = matched ?? (results[0]?.result as FoundOutcome | undefined);
  if (!result?.found) {
    if (canFallbackToCdp) {
      return await cdpType(params);
    }
    return { success: false, error: result?.error || 'Type failed' };
  }
  return { success: true, ...result };
}

export async function cmdHover(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = resolveSelector(params);
  const allFrames = Boolean(params.allFrames);
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (sel: string): FoundOutcome => {
      const queryDeep = (root: Document | ShadowRoot, selectorStr: string): Element | null => {
        const direct = root.querySelector(selectorStr);
        if (direct) return direct;
        const hosts = root.querySelectorAll('*');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const found = queryDeep(host.shadowRoot, selectorStr);
            if (found) return found;
          }
        }
        return null;
      };

      const el = queryDeep(document, sel) as HTMLElement | null;
      if (!el) return { found: false, error: `Element not found: ${sel}` };

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      const origOutline = el.style.outline;
      el.style.outline = '2px dashed #fbbc04';
      setTimeout(() => {
        el.style.outline = origOutline;
      }, 800);

      return { found: true, tagName: el.tagName };
    },
    args: [selector],
  });

  const matched = results.find((r) => (r.result as FoundOutcome | undefined)?.found)?.result as
    | FoundOutcome
    | undefined;
  const result = matched ?? (results[0]?.result as FoundOutcome | undefined);
  if (!result?.found) return { success: false, error: result?.error || 'Hover failed' };
  return { success: true, ...result };
}

export async function cmdSelect(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = resolveSelector(params);
  const value = params.value !== undefined ? String(params.value) : undefined;
  if (!selector) return { success: false, error: 'Missing parameter: selector' };
  if (value === undefined) return { success: false, error: 'Missing parameter: value' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel: string, val: string): FoundOutcome => {
      const queryDeep = (root: Document | ShadowRoot, selectorStr: string): Element | null => {
        const direct = root.querySelector(selectorStr);
        if (direct) return direct;
        const hosts = root.querySelectorAll('*');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const found = queryDeep(host.shadowRoot, selectorStr);
            if (found) return found;
          }
        }
        return null;
      };

      const el = queryDeep(document, sel) as HTMLSelectElement | null;
      if (!el) return { found: false, error: `Element not found: ${sel}` };
      if (el.tagName !== 'SELECT') return { found: false, error: 'Element is not a <select>' };

      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, selectedValue: el.value };
    },
    args: [selector, value],
  });

  const result = results[0]?.result as FoundOutcome | undefined;
  if (!result?.found) return { success: false, error: result?.error || 'Select failed' };
  return { success: true, ...result };
}

export async function cmdScroll(params: Record<string, unknown>): Promise<CommandResult> {
  const x = typeof params.x === 'number' ? params.x : 0;
  const y = typeof params.y === 'number' ? params.y : 0;
  const selector = resolveSelector(params) ?? null;
  const direction = typeof params.direction === 'string' ? params.direction : null;
  const amount = typeof params.amount === 'number' ? params.amount : 500;
  const allFrames = Boolean(params.allFrames);

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames },
    func: (
      scrollX: number,
      scrollY: number,
      sel: string | null,
      dir: string | null,
      amt: number,
    ): CommandResult => {
      const queryDeep = (root: Document | ShadowRoot, selectorStr: string): Element | null => {
        const direct = root.querySelector(selectorStr);
        if (direct) return direct;
        const hosts = root.querySelectorAll('*');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const found = queryDeep(host.shadowRoot, selectorStr);
            if (found) return found;
          }
        }
        return null;
      };

      let target: Window | Element = window;

      if (sel) {
        const el = queryDeep(document, sel);
        if (!el) return { success: false, error: `Element not found: ${sel}` };
        target = el;
      }

      if (dir) {
        const scrollMap: Record<string, { left: number; top: number }> = {
          up: { left: 0, top: -amt },
          down: { left: 0, top: amt },
          left: { left: -amt, top: 0 },
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
    args: [x, y, selector, direction, amount],
  });

  return (
    (results[0]?.result as CommandResult | undefined) ?? { success: false, error: 'Scroll failed' }
  );
}

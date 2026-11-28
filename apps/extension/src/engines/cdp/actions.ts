import { resolveTab } from '../../background/tab-group.js';
import type { CommandResult } from '../scripting/types.js';
import { cmdClearMarks, cmdSnapshot, resolveSelector } from '../snapshot/index.js';
import { sendCdpCommand } from './debugger-manager.js';

interface KeyMetadata {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const SPECIAL_KEYS: Record<string, KeyMetadata> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

function getModifierMask(modifiers: unknown): number {
  if (!Array.isArray(modifiers)) return 0;
  let mask = 0;
  for (const mod of modifiers) {
    if (mod === 'Alt') mask |= 1;
    else if (mod === 'Control') mask |= 2;
    else if (mod === 'Meta') mask |= 4;
    else if (mod === 'Shift') mask |= 8;
  }
  return mask;
}

function resolveKeyMetadata(key: string, explicitText?: string): KeyMetadata {
  const known = SPECIAL_KEYS[key];
  if (known) {
    return {
      ...known,
      ...(explicitText !== undefined ? { text: explicitText } : {}),
    };
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const charCode = upper.charCodeAt(0);
    const isLetter = charCode >= 65 && charCode <= 90;
    const isDigit = charCode >= 48 && charCode <= 57;
    return {
      key,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${upper}` : key,
      keyCode: upper.charCodeAt(0),
      text: explicitText ?? key,
    };
  }
  return {
    key,
    code: key,
    keyCode: 0,
    ...(explicitText !== undefined ? { text: explicitText } : {}),
  };
}

interface RectCenterResult {
  found: boolean;
  x?: number;
  y?: number;
  rect?: { x: number; y: number; width: number; height: number };
  tagName?: string;
  error?: string;
}

async function getElementBounds(tabId: number, selector: string): Promise<RectCenterResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string): RectCenterResult => {
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
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return {
        found: true,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        rect: {
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          width: r.width,
          height: r.height,
        },
        tagName: el.tagName,
      };
    },
    args: [selector],
  });

  return (
    (results[0]?.result as RectCenterResult | undefined) ?? {
      found: false,
      error: `Failed to inspect element: ${selector}`,
    }
  );
}

async function focusElement(tabId: number, selector: string, clear = false): Promise<void> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, shouldClear: boolean): { found: boolean; error?: string } => {
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
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();
      if (shouldClear && 'value' in el) {
        (el as HTMLInputElement | HTMLTextAreaElement).value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { found: true };
    },
    args: [selector, clear],
  });
  const res = results[0]?.result as { found: boolean; error?: string } | undefined;
  if (!res?.found) {
    throw new Error(res?.error || `Element not found: ${selector}`);
  }
}

export async function cmdPressKey(params: Record<string, unknown>): Promise<CommandResult> {
  const key = typeof params.key === 'string' && params.key.length > 0 ? params.key : undefined;
  if (!key) return { success: false, error: 'Missing parameter: key' };

  const explicitText = typeof params.text === 'string' ? params.text : undefined;
  const modifiers = getModifierMask(params.modifiers);
  const selector = resolveSelector(params);

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  if (selector) {
    try {
      await focusElement(tab.id, selector);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const meta = resolveKeyMetadata(key, explicitText);
  await sendCdpCommand(tab.id, 'Input.dispatchKeyEvent', {
    type: meta.text ? 'keyDown' : 'rawKeyDown',
    key: meta.key,
    code: meta.code,
    windowsVirtualKeyCode: meta.keyCode,
    nativeVirtualKeyCode: meta.keyCode,
    modifiers,
    ...(meta.text ? { text: meta.text, unmodifiedText: meta.text } : {}),
  });

  await sendCdpCommand(tab.id, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: meta.key,
    code: meta.code,
    windowsVirtualKeyCode: meta.keyCode,
    nativeVirtualKeyCode: meta.keyCode,
    modifiers,
  });

  return {
    success: true,
    tabId: tab.id,
    key: meta.key,
    code: meta.code,
    modifiers,
  };
}

export async function cmdDragAndDrop(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  let sourceX = typeof params.sourceX === 'number' ? params.sourceX : undefined;
  let sourceY = typeof params.sourceY === 'number' ? params.sourceY : undefined;
  let targetX = typeof params.targetX === 'number' ? params.targetX : undefined;
  let targetY = typeof params.targetY === 'number' ? params.targetY : undefined;

  const sourceSelector = resolveSelector(params, 'sourceSelector', 'sourceRef');
  const targetSelector = resolveSelector(params, 'targetSelector', 'targetRef');

  if (sourceSelector && (sourceX === undefined || sourceY === undefined)) {
    const bounds = await getElementBounds(tab.id, sourceSelector);
    if (!bounds.found || bounds.x === undefined || bounds.y === undefined) {
      return { success: false, error: bounds.error || `Source not found: ${sourceSelector}` };
    }
    sourceX = bounds.x;
    sourceY = bounds.y;
  }

  if (targetSelector && (targetX === undefined || targetY === undefined)) {
    const bounds = await getElementBounds(tab.id, targetSelector);
    if (!bounds.found || bounds.x === undefined || bounds.y === undefined) {
      return { success: false, error: bounds.error || `Target not found: ${targetSelector}` };
    }
    targetX = bounds.x;
    targetY = bounds.y;
  }

  if (
    sourceX === undefined ||
    sourceY === undefined ||
    targetX === undefined ||
    targetY === undefined
  ) {
    return {
      success: false,
      error: 'Missing source or target coordinates/selectors',
    };
  }

  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: sourceX,
    y: sourceY,
  });
  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sourceX,
    y: sourceY,
    button: 'left',
    clickCount: 1,
  });

  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const x = sourceX + ((targetX - sourceX) * i) / steps;
    const y = sourceY + ((targetY - sourceY) * i) / steps;
    await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
    });
  }

  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: targetX,
    y: targetY,
    button: 'left',
    clickCount: 1,
  });

  return {
    success: true,
    tabId: tab.id,
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
  };
}

export async function cmdUploadFile(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = resolveSelector(params);
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const files = Array.isArray(params.files)
    ? params.files.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : [];
  if (files.length === 0) return { success: false, error: 'Missing parameter: files' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const doc = await sendCdpCommand<{ root?: { nodeId?: number } }>(tab.id, 'DOM.getDocument', {
    depth: -1,
  });
  const rootNodeId = doc.root?.nodeId;
  if (!rootNodeId) {
    return { success: false, error: 'Failed to retrieve DOM root node' };
  }

  const queryRes = await sendCdpCommand<{ nodeId?: number }>(tab.id, 'DOM.querySelector', {
    nodeId: rootNodeId,
    selector,
  });
  if (!queryRes.nodeId) {
    return { success: false, error: `Element not found: ${selector}` };
  }

  await sendCdpCommand(tab.id, 'DOM.setFileInputFiles', {
    nodeId: queryRes.nodeId,
    files,
  });

  return {
    success: true,
    tabId: tab.id,
    nodeId: queryRes.nodeId,
    filesCount: files.length,
  };
}

export async function cdpClick(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = resolveSelector(params);
  if (!selector) return { success: false, error: 'Missing parameter: selector' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const bounds = await getElementBounds(tab.id, selector);
  if (!bounds.found || bounds.x === undefined || bounds.y === undefined) {
    return { success: false, error: bounds.error || `Element not found: ${selector}` };
  }

  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: bounds.x,
    y: bounds.y,
  });
  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: bounds.x,
    y: bounds.y,
    button: 'left',
    clickCount: 1,
  });
  await sendCdpCommand(tab.id, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: bounds.x,
    y: bounds.y,
    button: 'left',
    clickCount: 1,
  });

  return {
    success: true,
    engine: 'cdp',
    tabId: tab.id,
    tagName: bounds.tagName,
    x: bounds.x,
    y: bounds.y,
  };
}

export async function cdpType(params: Record<string, unknown>): Promise<CommandResult> {
  const selector = resolveSelector(params);
  const text = params.text !== undefined ? String(params.text) : undefined;
  const clear = params.clear === undefined ? true : Boolean(params.clear);

  if (!selector) return { success: false, error: 'Missing parameter: selector' };
  if (text === undefined) return { success: false, error: 'Missing parameter: text' };

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  try {
    await focusElement(tab.id, selector, clear);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  await sendCdpCommand(tab.id, 'Input.insertText', { text });

  return {
    success: true,
    engine: 'cdp',
    tabId: tab.id,
    length: text.length,
  };
}

export async function cdpScreenshot(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const format = params.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = typeof params.quality === 'number' ? params.quality : 80;
  const fullPage = Boolean(params.fullPage);
  const selector = resolveSelector(params);
  const markOverlay = Boolean(params.markOverlay);

  if (markOverlay) {
    await cmdSnapshot({ tabId: tab.id, markOverlay: true });
  }

  try {
    const captureParams: Record<string, unknown> = {
      format,
      ...(format === 'jpeg' ? { quality } : {}),
    };

    if (selector) {
      const bounds = await getElementBounds(tab.id, selector);
      if (!bounds.found || !bounds.rect) {
        return { success: false, error: bounds.error || `Element not found: ${selector}` };
      }
      captureParams.clip = {
        x: bounds.rect.x,
        y: bounds.rect.y,
        width: Math.max(1, bounds.rect.width),
        height: Math.max(1, bounds.rect.height),
        scale: 1,
      };
      captureParams.captureBeyondViewport = true;
    } else if (fullPage) {
      const metrics = await sendCdpCommand<{
        contentSize?: { width: number; height: number };
        cssContentSize?: { width: number; height: number };
      }>(tab.id, 'Page.getLayoutMetrics');
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size) {
        captureParams.clip = {
          x: 0,
          y: 0,
          width: Math.max(1, size.width),
          height: Math.max(1, size.height),
          scale: 1,
        };
      }
      captureParams.captureBeyondViewport = true;
    }

    const shot = await sendCdpCommand<{ data: string }>(
      tab.id,
      'Page.captureScreenshot',
      captureParams,
    );
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return {
      success: true,
      engine: 'cdp',
      tabId: tab.id,
      image: `data:${mime};base64,${shot.data}`,
    };
  } finally {
    if (markOverlay) {
      await cmdClearMarks({ tabId: tab.id }).catch(() => undefined);
    }
  }
}

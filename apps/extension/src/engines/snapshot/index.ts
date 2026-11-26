import type { SnapshotElement } from '@antigravity-bridge/protocol';
import { resolveTab } from '../../background/tab-group.js';
import type { CommandResult } from '../scripting/types.js';

export function resolveSelector(
  params: Record<string, unknown>,
  selectorKey = 'selector',
  refKey = 'ref',
): string | undefined {
  const selector = params[selectorKey];
  if (typeof selector === 'string' && selector.trim()) {
    return selector;
  }
  const ref = params[refKey];
  if (typeof ref === 'string' && ref.trim()) {
    const escaped = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `[data-agb-ref="${escaped}"]`;
  }
  return undefined;
}

interface SnapshotScriptResult {
  url: string;
  title: string;
  elements: SnapshotElement[];
  overlayRendered: boolean;
}

export async function cmdSnapshot(params: Record<string, unknown>): Promise<CommandResult> {
  const interactiveOnly =
    params.interactiveOnly === undefined ? true : Boolean(params.interactiveOnly);
  const markOverlay = Boolean(params.markOverlay);
  const maxElements =
    typeof params.maxElements === 'number' && params.maxElements > 0
      ? Math.floor(params.maxElements)
      : 150;

  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (
      onlyInteractive: boolean,
      renderOverlay: boolean,
      limit: number,
    ): SnapshotScriptResult => {
      const OVERLAY_ID = '__agb_som_overlay__';
      const existingOverlay = document.getElementById(OVERLAY_ID);
      if (existingOverlay) {
        existingOverlay.remove();
      }

      const previousRefs = document.querySelectorAll('[data-agb-ref]');
      for (const el of previousRefs) {
        el.removeAttribute('data-agb-ref');
      }

      const interactiveSelectors = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        'summary',
        '[role]',
        '[contenteditable="true"]',
        '[onclick]',
      ];
      const semanticSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      const query = onlyInteractive
        ? interactiveSelectors.join(', ')
        : [...interactiveSelectors, ...semanticSelectors].join(', ');

      const rawElements = Array.from(document.querySelectorAll<HTMLElement>(query));
      const seen = new Set<HTMLElement>();
      const collected: SnapshotElement[] = [];

      const inferRole = (el: HTMLElement): string => {
        const explicitRole = el.getAttribute('role');
        if (explicitRole) return explicitRole;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'summary') return 'button';
        if (tag === 'input') {
          const inputType = (el as HTMLInputElement).type?.toLowerCase() || 'text';
          if (inputType === 'checkbox') return 'checkbox';
          if (inputType === 'radio') return 'radio';
          if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') {
            return 'button';
          }
          return 'textbox';
        }
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (el.isContentEditable) return 'textbox';
        return tag;
      };

      const inferLabel = (el: HTMLElement): string => {
        const ariaLabel = el.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelText = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (labelText) return labelText;
        }

        if (el.id) {
          const explicitLabel = document.querySelector<HTMLLabelElement>(
            `label[for="${CSS.escape(el.id)}"]`,
          );
          const text = explicitLabel?.innerText?.trim();
          if (text) return text;
        }

        const parentLabel = el.closest('label');
        if (parentLabel) {
          const text = parentLabel.innerText?.trim();
          if (text) return text;
        }

        const title = el.getAttribute('title')?.trim();
        if (title) return title;

        const alt = el.getAttribute('alt')?.trim();
        if (alt) return alt;

        const placeholder = (el as Partial<HTMLInputElement>).placeholder?.trim();
        if (placeholder) return placeholder;

        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      };

      let overlayContainer: HTMLDivElement | null = null;
      if (renderOverlay) {
        overlayContainer = document.createElement('div');
        overlayContainer.id = OVERLAY_ID;
        overlayContainer.style.cssText =
          'pointer-events: none; position: fixed; inset: 0; z-index: 2147483647;';
      }

      let refCounter = 0;
      for (const el of rawElements) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (collected.length >= limit) break;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.opacity !== '0';

        if (!visible) continue;

        refCounter += 1;
        const ref = `@e${refCounter}`;
        el.setAttribute('data-agb-ref', ref);

        const tagName = el.tagName.toLowerCase();
        const inputEl = el as Partial<HTMLInputElement & HTMLAnchorElement>;
        const text = (el.innerText || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);
        const label = inferLabel(el);

        const item: SnapshotElement = {
          ref,
          role: inferRole(el),
          tagName,
          label,
          text,
          visible,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };

        if (typeof inputEl.value === 'string' && inputEl.value.length > 0) {
          item.value = inputEl.value;
        }
        if (typeof inputEl.placeholder === 'string' && inputEl.placeholder.length > 0) {
          item.placeholder = inputEl.placeholder;
        }
        if (tagName === 'a' && typeof inputEl.href === 'string' && inputEl.href.length > 0) {
          item.href = inputEl.href;
        }
        if (
          typeof inputEl.checked === 'boolean' &&
          (inputEl.type === 'checkbox' || inputEl.type === 'radio')
        ) {
          item.checked = inputEl.checked;
        }
        if (typeof inputEl.disabled === 'boolean' && inputEl.disabled) {
          item.disabled = true;
        }

        collected.push(item);

        if (overlayContainer) {
          const badge = document.createElement('div');
          badge.textContent = ref;
          badge.style.cssText = [
            'position: fixed',
            `left: ${Math.max(0, Math.round(rect.left))}px`,
            `top: ${Math.max(0, Math.round(rect.top))}px`,
            'background: #1a73e8',
            'color: #ffffff',
            'font: bold 11px/1.2 monospace',
            'padding: 1px 4px',
            'border-radius: 3px',
            'box-shadow: 0 1px 3px rgba(0,0,0,0.4)',
            'z-index: 2147483647',
          ].join('; ');
          overlayContainer.appendChild(badge);
        }
      }

      if (overlayContainer) {
        (document.body || document.documentElement).appendChild(overlayContainer);
      }

      return {
        url: location.href,
        title: document.title,
        elements: collected,
        overlayRendered: Boolean(overlayContainer),
      };
    },
    args: [interactiveOnly, markOverlay, maxElements],
  });

  const result = results[0]?.result as SnapshotScriptResult | undefined;
  if (!result) {
    return { success: false, error: 'Snapshot failed' };
  }

  let image: string | undefined;
  if (markOverlay && typeof chrome.tabs.captureVisibleTab === 'function') {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch {
      // Screenshot capture is optional if tab is not capturable in current context
    }
  }

  return {
    success: true,
    tabId: tab.id,
    url: result.url,
    title: result.title,
    count: result.elements.length,
    elements: result.elements,
    overlayRendered: result.overlayRendered,
    ...(image ? { image } : {}),
  };
}

export async function cmdClearMarks(params: Record<string, unknown>): Promise<CommandResult> {
  const tab = await resolveTab(params);
  if (tab.id === undefined) return { success: false, error: 'Resolved tab has no ID' };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (): { removed: boolean } => {
      const overlay = document.getElementById('__agb_som_overlay__');
      if (overlay) {
        overlay.remove();
        return { removed: true };
      }
      return { removed: false };
    },
  });

  const res = results[0]?.result as { removed: boolean } | undefined;
  return {
    success: true,
    tabId: tab.id,
    removed: res?.removed ?? false,
  };
}

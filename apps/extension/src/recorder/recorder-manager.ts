import { exportToBatchJson, exportToCliScript, exportToSdkCode } from './exporters.js';
import type { CommandFeedItem, ExportFormat, RecordedStep, RecorderState } from './types.js';

const MAX_COMMAND_FEED_ITEMS = 50;

interface RecorderWindow extends Window {
  __agbRecorderActive?: boolean;
  __agbRecorderInstalled?: boolean;
}

/**
 * Injected into the target tab via `chrome.scripting.executeScript`.
 * Must be completely self-contained (no closure over external helpers).
 */
export function injectRecorderContentListener(): void {
  const win = window as RecorderWindow;
  win.__agbRecorderActive = true;

  if (win.__agbRecorderInstalled) {
    return;
  }
  win.__agbRecorderInstalled = true;

  const escapeAttrValue = (val: string): string =>
    val.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

  const escapeCssIdent = (val: string): string => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(val);
    }
    return val.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  };

  const buildSelector = (el: Element): string => {
    if (el.id) {
      return `#${escapeCssIdent(el.id)}`;
    }
    const agbRef = el.getAttribute('data-agb-ref');
    if (agbRef) {
      return `[data-agb-ref="${escapeAttrValue(agbRef)}"]`;
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr) {
      const tag = el.tagName.toLowerCase();
      return `${tag}[name="${escapeAttrValue(nameAttr)}"]`;
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const tag = el.tagName.toLowerCase();
      return `${tag}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
    }

    const parts: string[] = [];
    let current: Element | null = el;
    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement
    ) {
      if (current.id) {
        parts.unshift(`#${escapeCssIdent(current.id)}`);
        break;
      }
      const tag = current.tagName.toLowerCase();
      let nth = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          nth += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      let hasSameTagFollowing = false;
      let next: Element | null = current.nextElementSibling;
      while (next) {
        if (next.tagName === current.tagName) {
          hasSameTagFollowing = true;
          break;
        }
        next = next.nextElementSibling;
      }
      parts.unshift(nth > 1 || hasSameTagFollowing ? `${tag}:nth-of-type(${nth})` : tag);
      if (parts.length >= 3) break;
      current = current.parentElement;
    }

    return parts.join(' > ') || el.tagName.toLowerCase();
  };

  const getElementLabel = (el: Element): string | undefined => {
    const raw =
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (el instanceof HTMLElement ? el.innerText : el.textContent) ||
      '';
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed.slice(0, 48) : undefined;
  };

  const emitStep = (step: RecordedStep): void => {
    if (!win.__agbRecorderActive) return;
    chrome.runtime.sendMessage({ type: 'recorder_event', step }).catch(() => {
      // Extension context may be reloading — ignore
    });
  };

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (!win.__agbRecorderActive) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const interactive =
        target.closest('a,button,input,select,textarea,[role="button"],[role="link"]') ?? target;
      const tag = interactive.tagName.toLowerCase();

      // Skip recording plain clicks on text inputs/selects because change event captures value
      if (tag === 'select') return;
      if (tag === 'input') {
        const type = ((interactive as HTMLInputElement).type || 'text').toLowerCase();
        if (!['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) {
          return;
        }
      }

      emitStep({
        timestamp: Date.now(),
        action: 'click',
        selector: buildSelector(interactive),
        label: getElementLabel(interactive),
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event: Event) => {
      if (!win.__agbRecorderActive) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target instanceof HTMLSelectElement) {
        emitStep({
          timestamp: Date.now(),
          action: 'select',
          selector: buildSelector(target),
          value: target.value,
          label: getElementLabel(target),
        });
        return;
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const inputType = target instanceof HTMLInputElement ? target.type.toLowerCase() : 'text';
        if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(inputType)) {
          return;
        }
        emitStep({
          timestamp: Date.now(),
          action: 'type',
          selector: buildSelector(target),
          text: target.value,
          label: getElementLabel(target),
        });
      }
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!win.__agbRecorderActive) return;
      if (event.key !== 'Enter' && event.key !== 'Escape' && event.key !== 'Tab') {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      emitStep({
        timestamp: Date.now(),
        action: 'press_key',
        key: event.key,
        ...(target && target !== document.body && target !== document.documentElement
          ? { selector: buildSelector(target), label: getElementLabel(target) }
          : {}),
      });
    },
    true,
  );
}

export function deactivateRecorderContentListener(): void {
  const win = window as RecorderWindow;
  win.__agbRecorderActive = false;
}

export class RecorderManager {
  private isRecording = false;
  private recordingTabId: number | null = null;
  private steps: RecordedStep[] = [];
  private commandHistory: CommandFeedItem[] = [];

  getState(): RecorderState {
    return {
      isRecording: this.isRecording,
      recordingTabId: this.recordingTabId,
      steps: [...this.steps],
    };
  }

  getCommandHistory(): CommandFeedItem[] {
    return [...this.commandHistory];
  }

  recordCommandExecution(item: CommandFeedItem): void {
    this.commandHistory.unshift(item);
    if (this.commandHistory.length > MAX_COMMAND_FEED_ITEMS) {
      this.commandHistory.length = MAX_COMMAND_FEED_ITEMS;
    }
    this.broadcastCommandFeed();
  }

  async startRecording(tabId?: number): Promise<RecorderState> {
    let targetTabId = tabId;
    let initialUrl: string | undefined;
    let initialTitle: string | undefined;

    if (targetTabId === undefined) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        throw new Error('No active tab found to start recording');
      }
      targetTabId = activeTab.id;
      initialUrl = activeTab.url;
      initialTitle = activeTab.title;
    } else {
      try {
        const tab = await chrome.tabs.get(targetTabId);
        initialUrl = tab.url;
        initialTitle = tab.title;
      } catch {
        // Ignore if tab metadata lookup fails
      }
    }

    // Deactivate previous tab listener if switching tabs while recording
    if (this.isRecording && this.recordingTabId !== null && this.recordingTabId !== targetTabId) {
      await this.deactivateTabListener(this.recordingTabId);
    }

    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: injectRecorderContentListener,
    });

    this.isRecording = true;
    this.recordingTabId = targetTabId;

    if (
      initialUrl &&
      !initialUrl.startsWith('chrome://') &&
      !initialUrl.startsWith('chrome-extension://') &&
      this.steps.length === 0
    ) {
      this.steps.push({
        timestamp: Date.now(),
        action: 'navigate',
        url: initialUrl,
        ...(initialTitle ? { label: initialTitle } : {}),
      });
    }

    this.broadcastRecorderUpdate();
    return this.getState();
  }

  async stopRecording(): Promise<RecorderState> {
    const prevTabId = this.recordingTabId;
    this.isRecording = false;
    this.recordingTabId = null;

    if (prevTabId !== null) {
      await this.deactivateTabListener(prevTabId);
    }

    this.broadcastRecorderUpdate();
    return this.getState();
  }

  clearSteps(): RecorderState {
    this.steps = [];
    this.broadcastRecorderUpdate();
    return this.getState();
  }

  addStep(step: RecordedStep): RecordedState {
    if (!this.isRecording) {
      return this.getState();
    }
    this.steps.push(step);
    this.broadcastRecorderUpdate();
    return this.getState();
  }

  handleTabUpdated(tabId: number, url?: string, title?: string): void {
    if (!this.isRecording || this.recordingTabId !== tabId) {
      return;
    }
    if (url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
      const last = this.steps[this.steps.length - 1];
      if (last?.action !== 'navigate' || last.url !== url) {
        this.steps.push({
          timestamp: Date.now(),
          action: 'navigate',
          url,
          ...(title ? { label: title } : {}),
        });
        this.broadcastRecorderUpdate();
      }
    }
  }

  async reinjectOnNavigation(tabId: number): Promise<void> {
    if (!this.isRecording || this.recordingTabId !== tabId) {
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectRecorderContentListener,
      });
    } catch {
      // Restricted pages (chrome://, etc.) cannot be scripted — ignore
    }
  }

  exportSteps(format: ExportFormat, name?: string): string {
    switch (format) {
      case 'batch_json':
        return exportToBatchJson(this.steps, name);
      case 'cli_script':
        return exportToCliScript(this.steps);
      case 'sdk_code':
        return exportToSdkCode(this.steps);
    }
  }

  private async deactivateTabListener(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: deactivateRecorderContentListener,
      });
    } catch {
      // Tab may already be closed or restricted
    }
  }

  private broadcastRecorderUpdate(): void {
    if (!chrome.runtime?.sendMessage) return;
    chrome.runtime
      .sendMessage({
        type: 'recorder_update',
        isRecording: this.isRecording,
        recordingTabId: this.recordingTabId,
        steps: [...this.steps],
      })
      .catch(() => {
        // Side panel / popup may not be open — ignore
      });
  }

  private broadcastCommandFeed(): void {
    if (!chrome.runtime?.sendMessage) return;
    chrome.runtime
      .sendMessage({
        type: 'command_feed_update',
        history: [...this.commandHistory],
      })
      .catch(() => {
        // Side panel / popup may not be open — ignore
      });
  }
}

export type RecordedState = RecorderState;

export const recorderManager = new RecorderManager();

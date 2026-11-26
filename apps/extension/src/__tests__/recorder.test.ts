import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportToBatchJson, exportToCliScript, exportToSdkCode } from '../recorder/exporters.js';
import { RecorderManager } from '../recorder/recorder-manager.js';
import type { RecordedStep } from '../recorder/types.js';

const SAMPLE_STEPS: RecordedStep[] = [
  {
    timestamp: 1000,
    action: 'navigate',
    url: 'https://example.com/login',
    label: 'Login Page',
  },
  {
    timestamp: 2000,
    action: 'type',
    selector: '#email',
    text: "user@example.com's",
    label: 'Email',
  },
  {
    timestamp: 3000,
    action: 'select',
    selector: 'select[name="role"]',
    value: 'admin',
    label: 'Role',
  },
  {
    timestamp: 4000,
    action: 'click',
    selector: 'button[type="submit"]',
    label: 'Sign in',
  },
  {
    timestamp: 5000,
    action: 'press_key',
    key: 'Enter',
    selector: '#email',
  },
];

interface MockChromeRecorder {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
}

function installMockChrome(): MockChromeRecorder {
  const mock: MockChromeRecorder = {
    tabs: {
      query: vi.fn(async () => [
        {
          id: 42,
          url: 'https://example.com/start',
          title: 'Start Page',
          active: true,
        },
      ]),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url: 'https://example.com/tab',
        title: 'Tab Page',
      })),
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
    },
  };

  (globalThis as unknown as { chrome: MockChromeRecorder }).chrome = mock;
  return mock;
}

describe('recorder exporters', () => {
  it('exports steps to valid Batch JSON workflow format', () => {
    const json = exportToBatchJson(SAMPLE_STEPS, 'Login Flow');
    const parsed = JSON.parse(json) as {
      name: string;
      steps: Array<{ action: string; params: Record<string, unknown> }>;
    };

    expect(parsed.name).toBe('Login Flow');
    expect(parsed.steps).toEqual([
      { action: 'navigate', params: { url: 'https://example.com/login' } },
      { action: 'type', params: { selector: '#email', text: "user@example.com's" } },
      { action: 'select', params: { selector: 'select[name="role"]', value: 'admin' } },
      { action: 'click', params: { selector: 'button[type="submit"]' } },
      { action: 'press_key', params: { key: 'Enter', selector: '#email' } },
    ]);
  });

  it('exports steps to agb CLI bash script with safe quoting', () => {
    const script = exportToCliScript(SAMPLE_STEPS);

    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain("agb nav 'https://example.com/login'");
    expect(script).toContain("agb type '#email' 'user@example.com'\\''s'");
    expect(script).toContain('agb click \'button[type="submit"]\'');
    expect(script).toContain("agb key 'Enter' --target '#email'");
    expect(script).toContain('agb eval ');
  });

  it('exports steps to TypeScript SDK script using AntigravityBridgeClient', () => {
    const code = exportToSdkCode(SAMPLE_STEPS);

    expect(code).toContain("import { AntigravityBridgeClient } from '@antigravity-bridge/sdk';");
    expect(code).toContain('const bridge = new AntigravityBridgeClient();');
    expect(code).toContain('await bridge.navigate("https://example.com/login");');
    expect(code).toContain('await bridge.type("#email", "user@example.com\'s");');
    expect(code).toContain('await bridge.select("select[name=\\"role\\"]", "admin");');
    expect(code).toContain('await bridge.click("button[type=\\"submit\\"]");');
    expect(code).toContain('await bridge.pressKey("Enter", { selector: "#email" });');
  });
});

describe('RecorderManager', () => {
  let mockChrome: MockChromeRecorder;
  let manager: RecorderManager;

  beforeEach(() => {
    mockChrome = installMockChrome();
    manager = new RecorderManager();
  });

  it('starts recording on active tab, records initial navigation, and broadcasts update', async () => {
    const state = await manager.startRecording();

    expect(state.isRecording).toBe(true);
    expect(state.recordingTabId).toBe(42);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.action).toBe('navigate');
    expect(state.steps[0]?.url).toBe('https://example.com/start');
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recorder_update',
        isRecording: true,
        recordingTabId: 42,
      }),
    );
  });

  it('adds steps only while recording and stops cleanly', async () => {
    // Ignored when not recording
    manager.addStep({ timestamp: 1, action: 'click', selector: '#ignored' });
    expect(manager.getState().steps).toHaveLength(0);

    await manager.startRecording(77);
    manager.addStep({ timestamp: 2, action: 'click', selector: '#btn' });
    expect(manager.getState().steps.map((s) => s.action)).toEqual(['navigate', 'click']);

    // Captures new URLs and deduplicates consecutive identical URL updates
    manager.handleTabUpdated(77, 'https://example.com/next', 'Next');
    expect(manager.getState().steps).toHaveLength(3);
    manager.handleTabUpdated(77, 'https://example.com/next', 'Next');
    expect(manager.getState().steps).toHaveLength(3);

    const stopped = await manager.stopRecording();
    expect(stopped.isRecording).toBe(false);
    expect(stopped.recordingTabId).toBeNull();
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(2);

    // Export works after stopping
    const exportedJson = manager.exportSteps('batch_json', 'Test Flow');
    expect(JSON.parse(exportedJson).steps).toHaveLength(3);

    const cleared = manager.clearSteps();
    expect(cleared.steps).toHaveLength(0);
  });

  it('bounds command history to 50 items and broadcasts command_feed_update', () => {
    for (let i = 1; i <= 60; i += 1) {
      manager.recordCommandExecution({
        id: `cmd-${i}`,
        action: 'snapshot',
        success: true,
        durationMs: i,
        timestamp: 1000 + i,
      });
    }

    const history = manager.getCommandHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.id).toBe('cmd-60');
    expect(history[49]?.id).toBe('cmd-11');
    expect(mockChrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'command_feed_update',
        history: expect.arrayContaining([expect.objectContaining({ id: 'cmd-60' })]),
      }),
    );
  });
});

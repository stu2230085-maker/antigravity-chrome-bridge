import { describe, expect, it } from 'vitest';
import {
  BatchRequestSchema,
  BatchResponseSchema,
  BatchStepSchema,
  COMMAND_ACTIONS,
  CommandActionSchema,
  CommandParamsSchemas,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT,
  ExtensionToServerMessageSchema,
  HelloMessageSchema,
  HttpCommandRequestSchema,
  ServerToExtensionMessageSchema,
  TAB_GROUP_TITLE,
  TypedCommandSchema,
  WsCommandEnvelopeSchema,
  WsCommandResponseSchema,
} from '../index.js';

describe('@antigravity-bridge/protocol', () => {
  it('exports expected default constants', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(DEFAULT_HTTP_PORT).toBe(8766);
    expect(DEFAULT_WS_PORT).toBe(8767);
    expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(30000);
    expect(TAB_GROUP_TITLE).toBe('🤖 Antigravity');
  });

  it('includes all 25 v1 + 7 v2 command actions (32 total)', () => {
    expect(COMMAND_ACTIONS).toHaveLength(32);
    expect(new Set(COMMAND_ACTIONS).size).toBe(32);
    for (const action of COMMAND_ACTIONS) {
      expect(CommandActionSchema.parse(action)).toBe(action);
      expect(CommandParamsSchemas[action]).toBeDefined();
    }
  });

  it('validates typed commands for all v1 and v2 action categories', () => {
    const validCases = [
      { action: 'navigate', params: { url: 'https://example.com' } },
      { action: 'new_tab', params: {} },
      { action: 'close_tab', params: { tabId: 12 } },
      { action: 'switch_tab', params: { tabId: 12 } },
      { action: 'go_back', params: {} },
      { action: 'go_forward', params: {} },
      { action: 'reload', params: {} },
      { action: 'get_url', params: {} },
      { action: 'get_tabs', params: {} },
      { action: 'click', params: { selector: '#submit', allFrames: true } },
      { action: 'click', params: { ref: '@e1', engine: 'cdp' } },
      { action: 'click_at', params: { x: 100, y: 200 } },
      { action: 'type', params: { selector: 'input[name=q]', text: 'hello', clear: false } },
      { action: 'type', params: { ref: '@e2', text: 'world', engine: 'auto' } },
      { action: 'hover', params: { selector: '.menu' } },
      { action: 'hover', params: { ref: '@e3', engine: 'scripting' } },
      { action: 'select', params: { selector: 'select#country', value: 'JP' } },
      { action: 'select', params: { ref: '@e4', value: 'US' } },
      { action: 'scroll', params: { direction: 'down', amount: 300 } },
      { action: 'scroll', params: { ref: '@e5', direction: 'down', engine: 'scripting' } },
      { action: 'get_content', params: { allFrames: true } },
      { action: 'get_text', params: { selector: 'main' } },
      { action: 'get_elements', params: { selector: 'a', limit: 10 } },
      {
        action: 'screenshot',
        params: { format: 'jpeg', quality: 85, fullPage: true, ref: '@e1', markOverlay: true },
      },
      { action: 'iframe_click', params: { selector: 'button', frameUrl: 'embed' } },
      { action: 'iframe_click_at', params: { x: 10, y: 20 } },
      { action: 'iframe_get_elements', params: { selector: 'button', limit: 5 } },
      { action: 'iframe_get_text', params: {} },
      { action: 'evaluate', params: { code: 'return document.title;' } },
      { action: 'wait_for', params: { selector: '.loaded', timeout: 5000 } },
      // 7 new v2 actions
      {
        action: 'snapshot',
        params: { tabId: 1, interactiveOnly: false, markOverlay: true, maxElements: 50 },
      },
      { action: 'clear_marks', params: { tabId: 1 } },
      {
        action: 'press_key',
        params: { key: 'Enter', modifiers: ['Control', 'Shift'], ref: '@e1', text: '\r' },
      },
      {
        action: 'drag_and_drop',
        params: { sourceRef: '@e1', targetSelector: '#dropzone' },
      },
      {
        action: 'drag_and_drop',
        params: { sourceX: 10, sourceY: 20, targetX: 100, targetY: 200 },
      },
      {
        action: 'upload_file',
        params: { ref: '@e6', files: ['/tmp/example.png'] },
      },
      {
        action: 'get_console_logs',
        params: { level: 'error', limit: 50, clear: true },
      },
      {
        action: 'get_network_logs',
        params: { urlPattern: 'api/', errorsOnly: true, limit: 25, clear: false },
      },
    ];

    for (const payload of validCases) {
      const parsed = TypedCommandSchema.safeParse(payload);
      expect(parsed.success, `Failed for ${payload.action}`).toBe(true);
    }
  });

  it('rejects invalid command params', () => {
    expect(TypedCommandSchema.safeParse({ action: 'navigate', params: {} }).success).toBe(false);
    expect(TypedCommandSchema.safeParse({ action: 'click', params: {} }).success).toBe(false);
    expect(TypedCommandSchema.safeParse({ action: 'type', params: { text: 'hi' } }).success).toBe(
      false,
    );
    expect(
      TypedCommandSchema.safeParse({ action: 'click', params: { ref: '@e1', engine: 'magic' } })
        .success,
    ).toBe(false);
    expect(
      TypedCommandSchema.safeParse({ action: 'click_at', params: { x: '10', y: 20 } }).success,
    ).toBe(false);
    expect(TypedCommandSchema.safeParse({ action: 'press_key', params: {} }).success).toBe(false);
    expect(TypedCommandSchema.safeParse({ action: 'drag_and_drop', params: {} }).success).toBe(
      false,
    );
    expect(
      TypedCommandSchema.safeParse({ action: 'upload_file', params: { ref: '@e1', files: [] } })
        .success,
    ).toBe(false);
    expect(TypedCommandSchema.safeParse({ action: 'unknown_action', params: {} }).success).toBe(
      false,
    );
  });

  it('validates v1 HTTP command requests with optional sessionId', () => {
    const v1 = HttpCommandRequestSchema.parse({ action: 'get_tabs' });
    expect(v1.action).toBe('get_tabs');
    expect(v1.sessionId).toBeUndefined();

    const v2 = HttpCommandRequestSchema.parse({
      action: 'navigate',
      params: { url: 'https://example.com' },
      sessionId: 'work-profile',
    });
    expect(v2.sessionId).toBe('work-profile');
  });

  it('validates batch execution schemas', () => {
    const step = BatchStepSchema.parse({
      action: 'click',
      params: { ref: '@e1' },
      delayMs: 100,
    });
    expect(step.delayMs).toBe(100);

    const req = BatchRequestSchema.parse({
      steps: [
        { action: 'navigate', params: { url: 'https://example.com' } },
        { action: 'snapshot', params: { interactiveOnly: true }, delayMs: 250 },
      ],
      stopOnError: true,
      sessionId: 'work',
    });
    expect(req.steps).toHaveLength(2);
    expect(BatchRequestSchema.safeParse({ steps: [] }).success).toBe(false);

    const res = BatchResponseSchema.parse({
      success: true,
      completedSteps: 2,
      totalSteps: 2,
      durationMs: 42,
      results: [
        { index: 0, action: 'navigate', success: true, id: 'c1', durationMs: 20, result: {} },
        { index: 1, action: 'snapshot', success: true, id: 'c2', durationMs: 22, result: {} },
      ],
    });
    expect(res.completedSteps).toBe(2);
  });

  it('validates WS envelopes, responses, keepalive, ping/pong, bridge_ready, and hello', () => {
    const envelope = WsCommandEnvelopeSchema.parse({
      id: 'cmd-1',
      action: 'click',
      params: { selector: '#ok' },
    });
    expect(envelope.params).toEqual({ selector: '#ok' });

    const response = WsCommandResponseSchema.parse({
      id: 'cmd-1',
      success: true,
      tabId: 42,
      url: 'https://example.com',
    });
    expect(response.success).toBe(true);
    expect((response as Record<string, unknown>).tabId).toBe(42);

    const hello = HelloMessageSchema.parse({
      type: 'hello',
      sessionId: 'sess-1',
      profile: 'default',
      version: '2.0.0',
    });
    expect(hello.profile).toBe('default');

    expect(
      ExtensionToServerMessageSchema.parse({ type: 'keepalive', timestamp: Date.now() }),
    ).toMatchObject({ type: 'keepalive' });
    expect(
      ExtensionToServerMessageSchema.parse({ type: 'ping', timestamp: Date.now() }),
    ).toMatchObject({ type: 'ping' });

    expect(
      ServerToExtensionMessageSchema.parse({ type: 'bridge_ready', timestamp: 1234 }),
    ).toMatchObject({ type: 'bridge_ready' });
    expect(ServerToExtensionMessageSchema.parse({ type: 'pong', timestamp: 1234 })).toMatchObject({
      type: 'pong',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
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

  it('includes all 25 v1 command actions', () => {
    expect(COMMAND_ACTIONS).toHaveLength(25);
    expect(new Set(COMMAND_ACTIONS).size).toBe(25);
    for (const action of COMMAND_ACTIONS) {
      expect(CommandActionSchema.parse(action)).toBe(action);
      expect(CommandParamsSchemas[action]).toBeDefined();
    }
  });

  it('validates typed commands for all action categories', () => {
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
      { action: 'click_at', params: { x: 100, y: 200 } },
      { action: 'type', params: { selector: 'input[name=q]', text: 'hello', clear: false } },
      { action: 'hover', params: { selector: '.menu' } },
      { action: 'select', params: { selector: 'select#country', value: 'JP' } },
      { action: 'scroll', params: { direction: 'down', amount: 300 } },
      { action: 'get_content', params: { allFrames: true } },
      { action: 'get_text', params: { selector: 'main' } },
      { action: 'get_elements', params: { selector: 'a', limit: 10 } },
      { action: 'screenshot', params: { format: 'jpeg', quality: 85 } },
      { action: 'iframe_click', params: { selector: 'button', frameUrl: 'embed' } },
      { action: 'iframe_click_at', params: { x: 10, y: 20 } },
      { action: 'iframe_get_elements', params: { selector: 'button', limit: 5 } },
      { action: 'iframe_get_text', params: {} },
      { action: 'evaluate', params: { code: 'return document.title;' } },
      { action: 'wait_for', params: { selector: '.loaded', timeout: 5000 } },
    ];

    for (const payload of validCases) {
      const parsed = TypedCommandSchema.safeParse(payload);
      expect(parsed.success, `Failed for ${payload.action}`).toBe(true);
    }
  });

  it('rejects invalid command params', () => {
    expect(TypedCommandSchema.safeParse({ action: 'navigate', params: {} }).success).toBe(false);
    expect(
      TypedCommandSchema.safeParse({ action: 'click_at', params: { x: '10', y: 20 } }).success,
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

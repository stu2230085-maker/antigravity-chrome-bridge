import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_TOKEN_STORAGE_KEY,
  buildAuthHeaders,
  buildEventsUrl,
  DashboardApiClient,
  extractImageDataUrl,
  extractSnapshotElements,
  formatDuration,
  formatUptime,
  loadStoredAuthToken,
  parseJsonParams,
  parseWorkflowSteps,
  prependTrace,
  saveStoredAuthToken,
} from '../api.js';

describe('@antigravity-bridge/dashboard API & formatting helpers', () => {
  it('builds Authorization Bearer header only when token is non-empty and persists token', () => {
    expect(buildAuthHeaders('')).toEqual({});
    expect(buildAuthHeaders('   ', { 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
    });
    expect(buildAuthHeaders('secret-123', { 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-123',
    });
    expect(buildEventsUrl('')).toBe('/api/v2/events');
    expect(buildEventsUrl('', 'secret 123')).toBe('/api/v2/events?token=secret%20123');
    expect(buildEventsUrl('http://127.0.0.1:8766/', 'tok')).toBe(
      'http://127.0.0.1:8766/api/v2/events?token=tok',
    );

    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    saveStoredAuthToken('  tok-abc  ', mockStorage);
    expect(store.get(AUTH_TOKEN_STORAGE_KEY)).toBe('tok-abc');
    expect(loadStoredAuthToken(mockStorage)).toBe('tok-abc');
  });

  it('parses JSON params & workflow steps cleanly and rejects invalid inputs', () => {
    expect(parseJsonParams('')).toEqual({});
    expect(parseJsonParams('{"url":"https://example.com"}')).toEqual({
      url: 'https://example.com',
    });
    expect(() => parseJsonParams('[1, 2]')).toThrow('Params must be a JSON object');

    const steps = parseWorkflowSteps(
      JSON.stringify([
        { action: 'navigate', params: { url: 'https://example.com' }, delayMs: 25.9 },
        { action: 'snapshot' },
      ]),
    );
    expect(steps).toEqual([
      { action: 'navigate', params: { url: 'https://example.com' }, delayMs: 25 },
      { action: 'snapshot' },
    ]);
    expect(() => parseWorkflowSteps('[]')).toThrow('non-empty JSON array');
    expect(() => parseWorkflowSteps('[{"params":{}}]')).toThrow('missing a valid "action"');
  });

  it('formats durations, uptimes, image data URLs, snapshot elements, and trace lists', () => {
    expect(formatDuration(42)).toBe('42ms');
    expect(formatDuration(1520)).toBe('1.52s');
    expect(formatUptime(10_000, 10_000 + 75_000)).toBe('1m 15s');

    expect(extractImageDataUrl({ image: 'iVBORw0KGgo=' })).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(extractImageDataUrl({ screenshot: 'data:image/jpeg;base64,abc' })).toBe(
      'data:image/jpeg;base64,abc',
    );
    expect(extractImageDataUrl({ ok: true })).toBeNull();

    const elements = extractSnapshotElements({
      elements: [
        { ref: '@e1', role: 'button', tagName: 'button', label: 'Submit', text: 'Submit' },
        { invalid: true },
      ],
    });
    expect(elements).toHaveLength(1);
    expect(elements[0]?.ref).toBe('@e1');

    const traces = prependTrace(
      [
        {
          id: 't1',
          sessionId: 's1',
          action: 'get_url',
          startedAt: 100,
          durationMs: 10,
          success: true,
        },
      ],
      {
        id: 't2',
        sessionId: 's1',
        action: 'click',
        startedAt: 200,
        durationMs: 20,
        success: true,
      },
    );
    expect(traces.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('sends authenticated API requests via DashboardApiClient', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true, id: 'cmd-1', result: { url: 'https://a.b' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new DashboardApiClient('http://127.0.0.1:9222', () => 'my-token', mockFetch);
    const res = await client.runCommand('get_url', {}, 'session-work');

    expect(res.id).toBe('cmd-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:9222/command');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer my-token',
      'Content-Type': 'application/json',
    });
    expect(init?.body).toBe(
      JSON.stringify({ action: 'get_url', params: {}, sessionId: 'session-work' }),
    );
  });
});

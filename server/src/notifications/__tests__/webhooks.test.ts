import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getJsonMock = vi.fn();
vi.mock('../../db/repositories/settings', () => ({
  default: { getJson: (key: string, def: unknown) => getJsonMock(key, def) },
}));

import { sendWebhook, fanOutWebhooks, type WebhookEnvelope } from '../webhooks';

const envelope: WebhookEnvelope = {
  event: 'DELETION_COMPLETE',
  timestamp: '2026-05-30T00:00:00.000Z',
  source: 'prunerr',
  version: 1,
  data: { itemsDeleted: 2 },
};

describe('sendWebhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getJsonMock.mockReset();
  });

  it('POSTs the envelope with the event header and succeeds on 2xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const result = await sendWebhook({ url: 'http://hook.test/x' }, envelope);

    expect(result.success).toBe(true);
    expect(result.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-Prunerr-Event']).toBe('DELETION_COMPLETE');
    expect(headers['X-Prunerr-Signature']).toBeUndefined();
    expect(JSON.parse(init!.body as string)).toMatchObject({ event: 'DELETION_COMPLETE', source: 'prunerr' });
  });

  it('signs the exact body with HMAC-SHA256 when a secret is set', async () => {
    let capturedBody = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = (init!.body as string);
      return new Response(null, { status: 200 });
    });

    const secret = 'topsecret';
    await sendWebhook({ url: 'http://hook.test/x', secret }, envelope);

    const expected = `sha256=${crypto.createHmac('sha256', secret).update(capturedBody).digest('hex')}`;
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['X-Prunerr-Signature']).toBe(expected);
  });

  it('does NOT retry on 4xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));
    const result = await sendWebhook({ url: 'http://hook.test/x' }, envelope, 3);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx up to the attempt limit', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('err', { status: 503 }));
    const result = await sendWebhook({ url: 'http://hook.test/x' }, envelope, 3);
    expect(result.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('fanOutWebhooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getJsonMock.mockReset();
  });

  it('only posts to enabled targets that opted into the event', async () => {
    getJsonMock.mockReturnValue([
      { id: 'a', url: 'http://a.test', enabled: true, events: ['DELETION_COMPLETE'] },
      { id: 'b', url: 'http://b.test', enabled: true, events: ['SCAN_COMPLETE'] }, // wrong event
      { id: 'c', url: 'http://c.test', enabled: false, events: ['DELETION_COMPLETE'] }, // disabled
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await fanOutWebhooks('DELETION_COMPLETE', { itemsDeleted: 1 }, '2026-05-30T00:00:00.000Z');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe('http://a.test');
  });

  it('no-ops when no targets match', async () => {
    getJsonMock.mockReturnValue([]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await fanOutWebhooks('DELETION_COMPLETE', {}, '2026-05-30T00:00:00.000Z');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Response } from 'express';

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { openSseStream } from '../sse';

/** Just enough of a response to watch what the stream writes. */
function fakeResponse() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const writes: string[] = [];
  Object.assign(res, {
    writes,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      if (res['writableEnded']) throw new Error('write after end');
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      res['writableEnded'] = true;
    }),
  });
  return res as unknown as Response & { writes: string[]; end: ReturnType<typeof vi.fn> };
}

afterEach(() => vi.useRealTimers());

describe('openSseStream', () => {
  it('stops writing once closed, and closes only once', () => {
    const res = fakeResponse();
    const onClose = vi.fn();
    const stream = openSseStream(res, onClose);

    stream.send({ stage: 'complete' });
    stream.close();
    stream.send({ stage: 'complete' });
    stream.close();

    expect(res.writes).toEqual(['data: {"stage":"complete"}\n\n']);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets go when the client disconnects or the response errors', () => {
    const res = fakeResponse();
    const onClose = vi.fn();
    const stream = openSseStream(res, onClose);

    res.emit('error', new Error('socket hang up'));
    stream.send({ stage: 'processing_items' });

    expect(stream.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(res.writes).toEqual([]);
  });

  it('sends a keepalive while idle, and stops after closing', () => {
    vi.useFakeTimers();
    const res = fakeResponse();
    const stream = openSseStream(res);

    vi.advanceTimersByTime(20_000);
    expect(res.writes).toEqual([': keepalive\n\n']);

    stream.close();
    vi.advanceTimersByTime(60_000);
    expect(res.writes).toHaveLength(1);
  });
});

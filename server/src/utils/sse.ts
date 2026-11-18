import type { Response } from 'express';
import logger from './logger';

/** How often an idle stream gets a comment line, so proxies don't drop it. */
const HEARTBEAT_MS = 20_000;

export interface SseStream {
  /** Write one event. Does nothing once the stream has closed. */
  send(data: unknown): void;
  /** End the response. Safe to call more than once. */
  close(): void;
  readonly closed: boolean;
}

/**
 * Turn a response into a server-sent event stream that can't crash the
 * process. A write after the response ends is emitted as an 'error' on it,
 * and with no handler Node treats that as fatal (issue #101). So writes stop
 * once the stream closes, whether we closed it or the client went away, and
 * response errors are handled here. Work the stream reports on carries on
 * after a client disconnects; `onClose` is where callers stop listening.
 */
export function openSseStream(res: Response, onClose?: () => void): SseStream {
  let closed = false;

  // Comment lines are ignored by SSE clients but count as traffic for
  // reverse proxies, which otherwise drop a stream that goes quiet.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    onClose?.();
    if (!res.writableEnded) res.end();
  };

  res.on('close', close);
  res.on('error', (error) => {
    logger.debug('SSE client error', { message: error.message });
    close();
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  return {
    send(data: unknown) {
      if (closed || res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close,
    get closed() {
      return closed;
    },
  };
}

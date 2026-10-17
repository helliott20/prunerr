import { describe, it, expect, vi } from 'vitest';

// Issue #85: a self-signed Unraid certificate failed the connection test with
// no hint about the cause or the workaround.

const post = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({ post, interceptors: { response: { use: vi.fn() } } }),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { UnraidService } from '../unraid';

describe('Unraid connection test', () => {
  it('explains a self-signed certificate failure', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    );

    await expect(new UnraidService('https://tower', 'key').testConnection()).rejects.toThrow(
      /NODE_TLS_REJECT_UNAUTHORIZED=0/
    );
  });

  it('still returns false for other failures', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    await expect(new UnraidService('http://tower', 'key').testConnection()).resolves.toBe(false);
  });
});

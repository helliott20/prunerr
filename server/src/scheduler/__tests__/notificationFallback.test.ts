import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks the deletion + notification services BEFORE tasks.ts imports them.
// We exercise the real code path of processDeletionQueue / sendDeletionReminders
// with DI deliberately unwired, asserting that the fallback to
// getNotificationService() actually fires the Discord notification.

const notifySpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../notifications', () => ({
  getNotificationService: () => ({
    notify: notifySpy,
  }),
}));

vi.mock('../../services/deletion', () => ({
  getDeletionService: () => ({
    getPendingDeletions: async () => [
      {
        id: 1,
        mediaItem: { id: 1, title: 'Test Movie', type: 'movie', file_size: 1_000_000_000 },
        ruleId: 42,
      },
    ],
    processPendingDeletions: async () => [
      {
        success: true,
        itemId: 1,
        title: 'Test Movie',
        action: 'unmonitor_and_delete',
        fileSizeFreed: 1_000_000_000,
      },
    ],
    getQueue: async () => [
      {
        id: 1,
        mediaItem: { id: 1, title: 'Imminent Movie' },
        daysRemaining: 1,
      },
    ],
  }),
}));

vi.mock('../../db/repositories/rules', () => ({
  default: {
    rules: { getById: () => ({ id: 42, name: 'Test rule' }) },
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processDeletionQueue, sendDeletionReminders, setTaskDependencies } from '../tasks';

describe('processDeletionQueue notification fallback', () => {
  beforeEach(() => {
    notifySpy.mockClear();
    // Wipe any DI a previous test set, simulating a server where init never
    // wired setTaskDependencies (or wired it after the cron fired).
    setTaskDependencies({});
  });

  it('falls back to getNotificationService() when DI unwired', async () => {
    await processDeletionQueue();

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [event, data] = notifySpy.mock.calls[0]!;
    expect(event).toBe('DELETION_COMPLETE');
    expect(data).toMatchObject({
      itemsDeleted: 1,
      items: [{ title: 'Test Movie', type: 'movie', ruleName: 'Test rule' }],
    });
  });

  it('uses the DI-provided notifier when wired', async () => {
    const wiredNotify = vi.fn().mockResolvedValue(undefined);
    setTaskDependencies({
      notificationService: { notify: wiredNotify },
    });

    await processDeletionQueue();

    expect(wiredNotify).toHaveBeenCalledTimes(1);
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('sendDeletionReminders notification fallback', () => {
  beforeEach(() => {
    notifySpy.mockClear();
    setTaskDependencies({});
  });

  it('falls back to getNotificationService() when DI unwired', async () => {
    await sendDeletionReminders();

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [event] = notifySpy.mock.calls[0]!;
    expect(event).toBe('DELETION_IMMINENT');
  });
});

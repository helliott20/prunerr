import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { sendWebhook, type WebhookEnvelope } from '../notifications/webhooks';
import type { NotificationEvent } from '../notifications/templates';

const router = Router();

/**
 * Build a representative sample payload so the receiver sees a realistic shape.
 */
function sampleData(event: NotificationEvent): WebhookEnvelope['data'] {
  switch (event) {
    case 'DISK_PRESSURE_TRIGGERED':
      return {
        severity: 'soft',
        path: '/data/media',
        freeBytes: 850_000_000_000,
        totalBytes: 12_000_000_000_000,
        targetBytes: 1_000_000_000_000,
        deficitBytes: 150_000_000_000,
        observeOnly: false,
        itemsQueued: 1,
        projectedReclaimBytes: 64_000_000_000,
        deletionAction: 'unmonitor_and_delete',
        items: [{ id: 1, title: 'Example Movie', type: 'movie', sizeBytes: 64_000_000_000 }],
        timestamp: new Date().toISOString(),
      };
    case 'DELETION_COMPLETE':
    default:
      return {
        itemsDeleted: 3,
        spaceFreedBytes: 96_000_000_000,
        spaceFreedGB: '89.4',
        errors: 0,
        items: [{ title: 'Example Movie', type: 'movie', ruleName: 'Unwatched > 6mo' }],
      };
  }
}

// POST /api/webhooks/test - Send a sample envelope to a webhook URL (no retry)
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { url, secret } = req.body ?? {};
    const event: NotificationEvent = (req.body?.event as NotificationEvent) || 'DELETION_COMPLETE';

    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: 'A webhook URL is required' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ success: false, error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ success: false, error: 'URL must use http or https' });
      return;
    }
    // Reject credentials embedded in the URL (avoid leaking creds / smuggling).
    if (parsed.username || parsed.password) {
      res.status(400).json({ success: false, error: 'URL must not contain credentials' });
      return;
    }

    const envelope: WebhookEnvelope = {
      event,
      timestamp: new Date().toISOString(),
      source: 'prunerr',
      version: 1,
      data: { ...sampleData(event), test: true },
    };

    // Single attempt — the user is waiting on the response.
    const result = await sendWebhook({ url, secret }, envelope, 1);

    if (result.success) {
      res.json({
        success: true,
        message: `Webhook delivered (HTTP ${result.status}).`,
        data: { status: result.status },
      });
    } else {
      // Redact the upstream error body — only surface the status code so we
      // don't echo arbitrary internal-endpoint responses back to the client.
      const safeError = result.status
        ? `Webhook delivery failed (HTTP ${result.status})`
        : 'Webhook delivery failed (no response)';
      res.status(400).json({
        success: false,
        error: safeError,
        data: { status: result.status },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to test webhook:', error);
    res.status(500).json({ success: false, error: `Failed to test webhook: ${message}` });
  }
});

export default router;

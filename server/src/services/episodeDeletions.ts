/**
 * Episode- and season-level deletions.
 *
 * A show is one row in media_items, so the normal deletion queue can only act
 * on a whole series. This module handles the finer grain: it resolves which
 * Sonarr episodes a request covers, queues them (one row per episode, so a
 * single episode can be cancelled later), and executes them against Sonarr
 * either immediately or once the grace period expires.
 */
import episodeDeletionsRepo, {
  type EpisodeDeletion,
  type NewEpisodeDeletion,
} from '../db/repositories/episodeDeletions';
import mediaItemsRepo from '../db/repositories/mediaItems';
import historyRepo from '../db/repositories/historyRepo';
import { logActivity } from '../db/repositories/activity';
import { getSonarrService } from './init';
import type { SonarrEpisode, SonarrEpisodeFile } from './types';
import type { MediaItem } from '../types';
import logger from '../utils/logger';

/** Deletion actions that make sense for a single episode. */
export const EPISODE_DELETION_ACTIONS = [
  'unmonitor_only',
  'delete_files_only',
  'unmonitor_and_delete',
] as const;

export type EpisodeDeletionAction = (typeof EPISODE_DELETION_ACTIONS)[number];

export function isEpisodeDeletionAction(value: string): value is EpisodeDeletionAction {
  return (EPISODE_DELETION_ACTIONS as readonly string[]).includes(value);
}

export function actionDeletesFiles(action: EpisodeDeletionAction): boolean {
  return action === 'delete_files_only' || action === 'unmonitor_and_delete';
}

export function actionUnmonitors(action: EpisodeDeletionAction): boolean {
  return action === 'unmonitor_only' || action === 'unmonitor_and_delete';
}

export interface EpisodeTarget {
  episode: SonarrEpisode;
  file?: SonarrEpisodeFile;
}

export interface ResolveTargetsInput {
  episodes: SonarrEpisode[];
  files: SonarrEpisodeFile[];
  episodeIds?: number[];
  seasonNumbers?: number[];
  action: EpisodeDeletionAction;
}

/**
 * Work out which episodes a request actually covers.
 *
 * Season numbers expand to their episodes, and an action that only deletes
 * files skips episodes that have none — so "delete season 2" on a half-grabbed
 * season queues the five episodes with files, not all ten.
 */
export function resolveTargets({
  episodes,
  files,
  episodeIds = [],
  seasonNumbers = [],
  action,
}: ResolveTargetsInput): EpisodeTarget[] {
  const filesById = new Map<number, SonarrEpisodeFile>();
  for (const file of files) filesById.set(file.id, file);

  const wantedEpisodeIds = new Set(episodeIds);
  const wantedSeasons = new Set(seasonNumbers);

  const targets: EpisodeTarget[] = [];
  const seen = new Set<number>();

  for (const episode of episodes) {
    const requested =
      wantedEpisodeIds.has(episode.id) || wantedSeasons.has(episode.seasonNumber);
    if (!requested || seen.has(episode.id)) continue;

    const file = episode.episodeFileId ? filesById.get(episode.episodeFileId) : undefined;

    // Nothing to delete and nothing to unmonitor means nothing to queue.
    if (!actionUnmonitors(action) && !file) continue;
    if (!actionDeletesFiles(action) && !episode.monitored) continue;

    seen.add(episode.id);
    targets.push(file ? { episode, file } : { episode });
  }

  return targets.sort(
    (a, b) =>
      a.episode.seasonNumber - b.episode.seasonNumber ||
      a.episode.episodeNumber - b.episode.episodeNumber
  );
}

/** `Severance · S02E03 · Who Is Alive?` — one readable label for logs and history. */
export function episodeLabel(
  seriesTitle: string,
  seasonNumber: number,
  episodeNumber: number,
  episodeTitle: string
): string {
  const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
  return `${seriesTitle} · ${code} · ${episodeTitle}`;
}

/** Grace deadline for a queued deletion; 0 days means "due at the next run". */
export function deleteAfterFor(gracePeriodDays: number, now: Date = new Date()): string {
  const deadline = new Date(now.getTime());
  deadline.setDate(deadline.getDate() + Math.max(0, gracePeriodDays));
  return deadline.toISOString();
}

export interface QueueEpisodesInput {
  item: MediaItem;
  seriesId: number;
  targets: EpisodeTarget[];
  action: EpisodeDeletionAction;
  gracePeriodDays: number;
  /** Immediate deletions log their own outcome, so they skip the queued entry. */
  skipActivityLog?: boolean;
  now?: Date;
}

/** Add resolved episodes to the deletion queue. Already-queued episodes are left alone. */
export function queueEpisodeDeletions({
  item,
  seriesId,
  targets,
  action,
  gracePeriodDays,
  skipActivityLog = false,
  now = new Date(),
}: QueueEpisodesInput): EpisodeDeletion[] {
  const deleteAfter = deleteAfterFor(gracePeriodDays, now);

  const rows: NewEpisodeDeletion[] = targets.map(({ episode, file }) => ({
    media_item_id: item.id,
    series_id: seriesId,
    season_number: episode.seasonNumber,
    episode_number: episode.episodeNumber,
    episode_id: episode.id,
    episode_file_id: file?.id ?? null,
    series_title: item.title,
    episode_title: episode.title,
    file_size: file?.size ?? 0,
    deletion_action: action,
    delete_after: deleteAfter,
  }));

  const created = episodeDeletionsRepo.createMany(rows);

  if (created.length > 0 && !skipActivityLog) {
    logActivity({
      eventType: 'manual_action',
      action: 'episodes_queued',
      actorType: 'user',
      actorName: 'Manual action',
      targetType: 'media_item',
      targetId: item.id,
      targetTitle: item.title,
      metadata: JSON.stringify({
        count: created.length,
        seasons: [...new Set(created.map((row) => row.season_number))].sort((a, b) => a - b),
        deletionAction: action,
        gracePeriodDays,
        deleteAfter,
        // The per-episode list backs the timeline's expandable detail.
        episodes: created.map(episodeDetail),
      }),
    });
  }

  return created;
}

/** Compact per-episode line used inside grouped activity metadata. */
function episodeDetail(row: EpisodeDeletion, freedBytes?: number): {
  code: string;
  title: string;
  size: number;
} {
  return {
    code: `S${String(row.season_number).padStart(2, '0')}E${String(row.episode_number).padStart(2, '0')}`,
    title: row.episode_title,
    size: freedBytes ?? row.file_size ?? 0,
  };
}

export interface EpisodeDeletionOutcome {
  episodeId: number;
  label: string;
  success: boolean;
  freedBytes: number;
  error?: string;
}

/**
 * Execute one queued episode against Sonarr.
 *
 * The Sonarr call is the only step allowed to fail the outcome: once the file
 * is gone, bookkeeping problems are logged but never reported as a failure.
 */
async function executeOne(row: EpisodeDeletion): Promise<EpisodeDeletionOutcome> {
  const action = isEpisodeDeletionAction(row.deletion_action)
    ? row.deletion_action
    : 'unmonitor_and_delete';
  const label = episodeLabel(
    row.series_title,
    row.season_number,
    row.episode_number,
    row.episode_title
  );

  const sonarr = getSonarrService();
  if (!sonarr) {
    return { episodeId: row.episode_id, label, success: false, freedBytes: 0, error: 'Sonarr is not configured' };
  }

  let freedBytes = 0;

  try {
    if (actionDeletesFiles(action) && row.episode_file_id) {
      await sonarr.deleteEpisodeFile(row.episode_file_id);
      freedBytes = row.file_size || 0;
    }
    if (actionUnmonitors(action)) {
      await sonarr.unmonitorEpisodes([row.episode_id]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to delete episode "${label}" in Sonarr: ${message}`);
    return { episodeId: row.episode_id, label, success: false, freedBytes: 0, error: message };
  }

  // Post-delete bookkeeping. Each step is independent: the file is already gone.
  if (freedBytes > 0) {
    try {
      const item = mediaItemsRepo.getById(row.media_item_id);
      if (item) {
        mediaItemsRepo.update(row.media_item_id, {
          file_size: Math.max(0, (item.file_size || 0) - freedBytes),
        });
      }
    } catch (sizeError) {
      logger.warn(`Failed to adjust library size for "${label}":`, sizeError);
    }

    try {
      historyRepo.create({
        media_item_id: row.media_item_id,
        title: label,
        type: 'episode',
        file_size: freedBytes,
        deletion_type: 'manual',
      });
    } catch (historyError) {
      logger.warn(`Failed to record deletion history for "${label}":`, historyError);
    }
  }

  logger.info(`Episode deletion complete: "${label}" (action: ${action}, freed: ${freedBytes} bytes)`);
  return { episodeId: row.episode_id, label, success: true, freedBytes };
}

/**
 * Unmonitor the season itself once every episode in it is unmonitored, so
 * Sonarr stops chasing the season rather than just the episodes we touched.
 */
async function syncSeasonMonitoring(seriesId: number, seasonNumbers: number[]): Promise<void> {
  const sonarr = getSonarrService();
  if (!sonarr || seasonNumbers.length === 0) return;

  try {
    const episodes = await sonarr.getEpisodes(seriesId);
    for (const seasonNumber of new Set(seasonNumbers)) {
      const seasonEpisodes = episodes.filter((e) => e.seasonNumber === seasonNumber);
      if (seasonEpisodes.length === 0) continue;
      if (seasonEpisodes.every((e) => !e.monitored)) {
        await sonarr.setSeasonMonitored(seriesId, seasonNumber, false);
      }
    }
  } catch (error) {
    logger.warn(`Failed to sync season monitoring for series ${seriesId}:`, error);
  }
}

export interface ProcessResult {
  processed: number;
  deleted: number;
  failed: number;
  freedBytes: number;
  outcomes: EpisodeDeletionOutcome[];
}

/**
 * Log one activity entry per show for a batch, rather than one per episode:
 * deleting a season should read as a single line on the show's timeline, with
 * the episodes available underneath it.
 */
function logBatchActivity(completed: Array<{ row: EpisodeDeletion; freedBytes: number }>): void {
  const byItem = new Map<number, Array<{ row: EpisodeDeletion; freedBytes: number }>>();
  for (const entry of completed) {
    const group = byItem.get(entry.row.media_item_id) ?? [];
    group.push(entry);
    byItem.set(entry.row.media_item_id, group);
  }

  for (const [mediaItemId, group] of byItem) {
    const first = group[0]!.row;
    const freedBytes = group.reduce((sum, entry) => sum + entry.freedBytes, 0);

    try {
      logActivity({
        eventType: 'deletion',
        // Files gone reads differently from a monitoring change, so name it for
        // what actually happened rather than what was asked for.
        action: freedBytes > 0 ? 'episodes_deleted' : 'episodes_unmonitored',
        actorType: 'user',
        actorName: 'Manual action',
        targetType: 'media_item',
        targetId: mediaItemId,
        targetTitle: first.series_title,
        metadata: JSON.stringify({
          mediaType: 'episode',
          count: group.length,
          freedBytes,
          deletionAction: first.deletion_action,
          seasons: [...new Set(group.map((entry) => entry.row.season_number))].sort((a, b) => a - b),
          episodes: group.map((entry) => episodeDetail(entry.row, entry.freedBytes)),
        }),
      });
    } catch (activityError) {
      logger.warn(`Failed to log episode deletion activity for item ${mediaItemId}:`, activityError);
    }
  }
}

/** Run a set of queued rows, updating each one's status as it goes. */
export async function executeQueuedDeletions(rows: EpisodeDeletion[]): Promise<ProcessResult> {
  const outcomes: EpisodeDeletionOutcome[] = [];
  const completed: Array<{ row: EpisodeDeletion; freedBytes: number }> = [];
  let freedBytes = 0;
  const unmonitoredSeasons = new Map<number, number[]>();

  for (const row of rows) {
    const outcome = await executeOne(row);
    outcomes.push(outcome);

    if (outcome.success) {
      episodeDeletionsRepo.markCompleted(row.id, outcome.freedBytes);
      completed.push({ row, freedBytes: outcome.freedBytes });
      freedBytes += outcome.freedBytes;

      const action = isEpisodeDeletionAction(row.deletion_action)
        ? row.deletion_action
        : 'unmonitor_and_delete';
      if (actionUnmonitors(action)) {
        const seasons = unmonitoredSeasons.get(row.series_id) ?? [];
        seasons.push(row.season_number);
        unmonitoredSeasons.set(row.series_id, seasons);
      }
    } else {
      episodeDeletionsRepo.markFailed(row.id, outcome.error || 'Unknown error');
    }
  }

  if (completed.length > 0) logBatchActivity(completed);

  for (const [seriesId, seasons] of unmonitoredSeasons) {
    await syncSeasonMonitoring(seriesId, seasons);
  }

  const failed = outcomes.filter((o) => !o.success).length;
  return {
    processed: rows.length,
    deleted: outcomes.length - failed,
    failed,
    freedBytes,
    outcomes,
  };
}

/**
 * Process queued episode deletions whose grace period has expired.
 * `force` processes every pending row regardless of its deadline.
 */
export async function processDueEpisodeDeletions(
  options: { force?: boolean; now?: Date } = {}
): Promise<ProcessResult> {
  const rows = options.force
    ? episodeDeletionsRepo.getAllPending()
    : episodeDeletionsRepo.getDue(options.now ?? new Date());

  if (rows.length === 0) {
    return { processed: 0, deleted: 0, failed: 0, freedBytes: 0, outcomes: [] };
  }

  logger.info(`Processing ${rows.length} queued episode deletion(s)`);
  return executeQueuedDeletions(rows);
}

export default {
  resolveTargets,
  queueEpisodeDeletions,
  executeQueuedDeletions,
  processDueEpisodeDeletions,
};

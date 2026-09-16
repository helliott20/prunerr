/**
 * Sonarr series detail builder.
 *
 * Merges the three Sonarr payloads the library detail view needs — series,
 * episodes, episode files — plus the download queue into one season/episode
 * tree with a per-episode state. Kept as a pure function (no HTTP, no db) so
 * the merge rules are unit-testable and the route stays thin.
 */
import type {
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrQueueRecord,
  SonarrSeries,
} from './types';

/** Where an episode stands in Sonarr, in the order the UI cares about. */
export type SonarrEpisodeState =
  | 'downloaded'
  | 'downloading'
  | 'missing'
  | 'unaired'
  | 'unmonitored';

export interface SonarrEpisodeFileSummary {
  id: number;
  size: number;
  relativePath?: string;
  path?: string;
  dateAdded?: string;
  quality?: string;
  /** Set when the release is a PROPER/REPACK of the same quality. */
  qualityRevision?: 'PROPER' | 'REPACK';
  /** Sonarr flags the file as upgradable under the series' quality profile. */
  qualityCutoffNotMet: boolean;
  releaseGroup?: string;
  sceneName?: string;
  languages?: string[];
  resolution?: string;
  videoCodec?: string;
  videoBitrate?: number;
  audioCodec?: string;
  audioChannels?: number;
  subtitles?: string[];
  runTime?: string;
}

export interface SonarrEpisodeDownload {
  status: string;
  state?: string;
  /** 0-100, how much of the release has been grabbed. */
  progress: number;
  size: number;
  sizeleft: number;
  estimatedCompletionTime?: string;
  errorMessage?: string;
  title?: string;
}

/** A queued deletion for one episode (see episode_deletions). */
export interface SonarrEpisodeQueued {
  id: number;
  action: string;
  markedAt: string;
  deleteAfter: string;
}

export interface SonarrEpisodeSummary {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  monitored: boolean;
  hasFile: boolean;
  state: SonarrEpisodeState;
  file?: SonarrEpisodeFileSummary;
  download?: SonarrEpisodeDownload;
  /** Set when this episode is sitting in the deletion queue. */
  queued?: SonarrEpisodeQueued;
}

export interface SonarrSeasonSummary {
  seasonNumber: number;
  monitored: boolean;
  episodeCount: number;
  airedCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
  missingCount: number;
  downloadingCount: number;
  cutoffUnmetCount: number;
  queuedCount: number;
  /** Aired episodes that have a file, as a 0-100 percentage. */
  percentComplete: number;
  episodes: SonarrEpisodeSummary[];
}

export interface SonarrSeriesSummary {
  id: number;
  title: string;
  status: string;
  ended: boolean;
  monitored: boolean;
  seriesType: string;
  network?: string;
  path?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  qualityProfileName?: string;
  runtime?: number;
  certification?: string;
  genres: string[];
  tags: string[];
  added?: string;
  previousAiring?: string;
  nextAiring?: string;
  airTime?: string;
}

export interface SonarrSeriesTotals {
  seasonCount: number;
  episodeCount: number;
  airedCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
  missingCount: number;
  downloadingCount: number;
  cutoffUnmetCount: number;
  queuedCount: number;
  percentComplete: number;
}

export interface SonarrSeriesDetail {
  series: SonarrSeriesSummary;
  totals: SonarrSeriesTotals;
  seasons: SonarrSeasonSummary[];
}

export interface BuildSonarrSeriesDetailInput {
  series: SonarrSeries;
  episodes: SonarrEpisode[];
  files: SonarrEpisodeFile[];
  queue?: SonarrQueueRecord[];
  /** Resolved from the series' qualityProfileId; omitted when unavailable. */
  qualityProfileName?: string;
  tagLabels?: Map<number, string>;
  /** Queued deletions keyed by Sonarr episode id. */
  queuedByEpisodeId?: Map<number, SonarrEpisodeQueued>;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return numerator > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
}

function hasAired(episode: SonarrEpisode, now: Date): boolean {
  const airDate = episode.airDateUtc || episode.airDate;
  if (!airDate) return false;
  const parsed = new Date(airDate).getTime();
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime();
}

function toFileSummary(file: SonarrEpisodeFile): SonarrEpisodeFileSummary {
  const revision = file.quality?.revision;
  const languages = file.languages?.length
    ? file.languages.map((lang) => lang.name).filter(Boolean)
    : file.language?.name
      ? [file.language.name]
      : undefined;
  const subtitles = file.mediaInfo?.subtitles
    ? file.mediaInfo.subtitles
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const summary: SonarrEpisodeFileSummary = {
    id: file.id,
    size: file.size ?? 0,
    qualityCutoffNotMet: Boolean(file.qualityCutoffNotMet),
  };

  if (file.relativePath) summary.relativePath = file.relativePath;
  if (file.path) summary.path = file.path;
  if (file.dateAdded) summary.dateAdded = file.dateAdded;
  if (file.quality?.quality?.name) summary.quality = file.quality.quality.name;
  if (revision?.isRepack) summary.qualityRevision = 'REPACK';
  else if ((revision?.version ?? 1) > 1) summary.qualityRevision = 'PROPER';
  if (file.releaseGroup) summary.releaseGroup = file.releaseGroup;
  if (file.sceneName) summary.sceneName = file.sceneName;
  if (languages?.length) summary.languages = languages;
  if (file.mediaInfo?.resolution) summary.resolution = file.mediaInfo.resolution;
  if (file.mediaInfo?.videoCodec) summary.videoCodec = file.mediaInfo.videoCodec;
  if (file.mediaInfo?.videoBitrate) summary.videoBitrate = file.mediaInfo.videoBitrate;
  if (file.mediaInfo?.audioCodec) summary.audioCodec = file.mediaInfo.audioCodec;
  if (file.mediaInfo?.audioChannels) summary.audioChannels = file.mediaInfo.audioChannels;
  if (subtitles?.length) summary.subtitles = subtitles;
  if (file.mediaInfo?.runTime) summary.runTime = file.mediaInfo.runTime;

  return summary;
}

function toDownload(record: SonarrQueueRecord): SonarrEpisodeDownload {
  const size = record.size ?? 0;
  const sizeleft = record.sizeleft ?? 0;
  const download: SonarrEpisodeDownload = {
    status: record.status,
    progress: size > 0 ? percent(size - sizeleft, size) : 0,
    size,
    sizeleft,
  };
  if (record.trackedDownloadState) download.state = record.trackedDownloadState;
  if (record.estimatedCompletionTime) download.estimatedCompletionTime = record.estimatedCompletionTime;
  if (record.errorMessage) download.errorMessage = record.errorMessage;
  if (record.title) download.title = record.title;
  return download;
}

function resolveState(
  episode: SonarrEpisode,
  file: SonarrEpisodeFile | undefined,
  download: SonarrEpisodeDownload | undefined,
  now: Date
): SonarrEpisodeState {
  if (episode.hasFile || file) return 'downloaded';
  if (download) return 'downloading';
  if (!hasAired(episode, now)) return 'unaired';
  if (!episode.monitored) return 'unmonitored';
  return 'missing';
}

/**
 * Merge Sonarr's series/episode/file/queue payloads into the season tree the
 * library detail view renders.
 *
 * Seasons come back in ascending order with specials (season 0) last, which is
 * how Sonarr itself presents them; episodes are ascending within a season.
 */
export function buildSonarrSeriesDetail({
  series,
  episodes,
  files,
  queue = [],
  qualityProfileName,
  tagLabels,
  queuedByEpisodeId,
  now = new Date(),
}: BuildSonarrSeriesDetailInput): SonarrSeriesDetail {
  const filesById = new Map<number, SonarrEpisodeFile>();
  for (const file of files) filesById.set(file.id, file);

  const queueByEpisodeId = new Map<number, SonarrQueueRecord>();
  for (const record of queue) {
    if (record.seriesId !== undefined && record.seriesId !== series.id) continue;
    if (record.episodeId === undefined) continue;
    // Keep the first record per episode: Sonarr lists the active grab first.
    if (!queueByEpisodeId.has(record.episodeId)) queueByEpisodeId.set(record.episodeId, record);
  }

  const seasonMonitored = new Map<number, boolean>();
  for (const season of series.seasons ?? []) {
    seasonMonitored.set(season.seasonNumber, season.monitored);
  }

  const bySeason = new Map<number, SonarrEpisodeSummary[]>();

  for (const episode of episodes) {
    const file = episode.episodeFileId ? filesById.get(episode.episodeFileId) : undefined;
    const queueRecord = queueByEpisodeId.get(episode.id);
    const download = queueRecord ? toDownload(queueRecord) : undefined;

    const summary: SonarrEpisodeSummary = {
      id: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      monitored: Boolean(episode.monitored),
      hasFile: Boolean(episode.hasFile || file),
      state: resolveState(episode, file, download, now),
    };

    const airDate = episode.airDateUtc || episode.airDate;
    if (airDate) summary.airDateUtc = airDate;
    if (file) summary.file = toFileSummary(file);
    if (download) summary.download = download;
    const queued = queuedByEpisodeId?.get(episode.id);
    if (queued) summary.queued = queued;

    const bucket = bySeason.get(episode.seasonNumber);
    if (bucket) bucket.push(summary);
    else bySeason.set(episode.seasonNumber, [summary]);
  }

  // Seasons Sonarr knows about but that have no episodes yet still deserve a row.
  for (const seasonNumber of seasonMonitored.keys()) {
    if (!bySeason.has(seasonNumber)) bySeason.set(seasonNumber, []);
  }

  const seasons: SonarrSeasonSummary[] = [...bySeason.entries()]
    .map(([seasonNumber, seasonEpisodes]) => {
      seasonEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

      const episodeFileCount = seasonEpisodes.filter((e) => e.state === 'downloaded').length;
      const airedCount = seasonEpisodes.filter(
        (e) => e.state !== 'unaired'
      ).length;
      const sizeOnDisk = seasonEpisodes.reduce((total, e) => total + (e.file?.size ?? 0), 0);

      return {
        seasonNumber,
        monitored: seasonMonitored.get(seasonNumber) ?? false,
        episodeCount: seasonEpisodes.length,
        airedCount,
        episodeFileCount,
        sizeOnDisk,
        missingCount: seasonEpisodes.filter((e) => e.state === 'missing').length,
        downloadingCount: seasonEpisodes.filter((e) => e.state === 'downloading').length,
        cutoffUnmetCount: seasonEpisodes.filter((e) => e.file?.qualityCutoffNotMet).length,
        queuedCount: seasonEpisodes.filter((e) => e.queued).length,
        percentComplete: percent(episodeFileCount, airedCount),
        episodes: seasonEpisodes,
      };
    })
    .sort((a, b) => {
      // Specials (season 0) sit at the end, everything else ascending.
      if (a.seasonNumber === 0) return 1;
      if (b.seasonNumber === 0) return -1;
      return a.seasonNumber - b.seasonNumber;
    });

  const totals = seasons.reduce<SonarrSeriesTotals>(
    (acc, season) => ({
      seasonCount: acc.seasonCount + (season.seasonNumber === 0 ? 0 : 1),
      episodeCount: acc.episodeCount + season.episodeCount,
      airedCount: acc.airedCount + season.airedCount,
      episodeFileCount: acc.episodeFileCount + season.episodeFileCount,
      sizeOnDisk: acc.sizeOnDisk + season.sizeOnDisk,
      missingCount: acc.missingCount + season.missingCount,
      downloadingCount: acc.downloadingCount + season.downloadingCount,
      cutoffUnmetCount: acc.cutoffUnmetCount + season.cutoffUnmetCount,
      queuedCount: acc.queuedCount + season.queuedCount,
      percentComplete: 0,
    }),
    {
      seasonCount: 0,
      episodeCount: 0,
      airedCount: 0,
      episodeFileCount: 0,
      sizeOnDisk: 0,
      missingCount: 0,
      downloadingCount: 0,
      cutoffUnmetCount: 0,
      queuedCount: 0,
      percentComplete: 0,
    }
  );
  totals.percentComplete = percent(totals.episodeFileCount, totals.airedCount);
  // Sonarr's own statistics are authoritative for disk usage when present
  // (they include files our episode list may not cover, e.g. after a rescan).
  if (!totals.sizeOnDisk && series.statistics?.sizeOnDisk) {
    totals.sizeOnDisk = series.statistics.sizeOnDisk;
  }

  const nextAiring = episodes
    .map((e) => e.airDateUtc)
    .filter((date): date is string => Boolean(date) && new Date(date!).getTime() > now.getTime())
    .sort()[0];

  const seriesSummary: SonarrSeriesSummary = {
    id: series.id,
    title: series.title,
    status: series.status,
    ended: Boolean(series.ended),
    monitored: Boolean(series.monitored),
    seriesType: series.seriesType,
    genres: series.genres ?? [],
    tags: (series.tags ?? [])
      .map((tagId) => tagLabels?.get(tagId))
      .filter((label): label is string => Boolean(label)),
  };

  if (series.network) seriesSummary.network = series.network;
  if (series.path) seriesSummary.path = series.path;
  if (series.rootFolderPath) seriesSummary.rootFolderPath = series.rootFolderPath;
  if (series.qualityProfileId) seriesSummary.qualityProfileId = series.qualityProfileId;
  if (qualityProfileName) seriesSummary.qualityProfileName = qualityProfileName;
  if (series.runtime) seriesSummary.runtime = series.runtime;
  if (series.certification) seriesSummary.certification = series.certification;
  if (series.added) seriesSummary.added = series.added;
  if (series.previousAiring) seriesSummary.previousAiring = series.previousAiring;
  if (nextAiring) seriesSummary.nextAiring = nextAiring;
  if (series.airTime) seriesSummary.airTime = series.airTime;

  return { series: seriesSummary, totals, seasons };
}

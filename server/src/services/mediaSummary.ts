import type { SonarrEpisodeFile } from './types';

/**
 * Plex reports a show's media info on its episodes, never on the show itself,
 * so a scanned series has no resolution, codec or bitrate of its own — the
 * detail page showed "Unknown" for every one of them.
 *
 * Sonarr does hold that per file, so these helpers roll a series' episode files
 * up into one representative answer.
 */

export interface MediaSummary {
  resolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  /** Bits per second, matching how Plex-sourced bitrates are stored. */
  bitrate?: number;
}

/**
 * Sonarr reports `1920x1080`; Plex — and therefore the rules engine, which
 * reads the first number it finds — expects `1080`. Normalise to Plex's shape
 * so a Sonarr-derived value is comparable with a Plex-derived one.
 */
export function normaliseResolution(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;

  // `1920x1080` → `1080`. Keyed off the width, because that is what holds
  // steady across aspect ratios: a 2.39:1 release at 1080p is 1920x800, and
  // going by height would file it as 720.
  const dimensions = /^(\d{3,5})\s*[x×]\s*(\d{3,5})$/.exec(value);
  if (dimensions?.[1] && dimensions[2]) {
    const width = Number(dimensions[1]);
    if (width >= 3400) return '2160';
    if (width >= 2400) return '1440';
    if (width >= 1700) return '1080';
    if (width >= 1100) return '720';
    if (width >= 700) return '480';
    return String(Number(dimensions[2]));
  }

  if (value === '4k' || value === 'uhd' || value === '2160p') return '2160';
  if (value === '1080p') return '1080';
  if (value === '720p') return '720';
  if (value === 'sd') return '480';

  // Already a bare number, e.g. Plex's own `1080`.
  if (/^\d{3,4}$/.test(value)) return value;

  return undefined;
}

/** The value held by the most files; ties go to whichever came first. */
function dominant(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * What the series looks like on disk, as one answer.
 *
 * A show is rarely uniform — a remastered season, one episode grabbed at a
 * lower quality — so this reports what most of the files are rather than the
 * best or the worst, which is what someone deciding whether to keep a series
 * wants to see. Bitrate is averaged instead, since a single file's is not
 * representative of the series.
 */
export function summariseEpisodeFiles(files: SonarrEpisodeFile[]): MediaSummary {
  const withInfo = files.filter((file) => file.mediaInfo);
  if (withInfo.length === 0) return {};

  const summary: MediaSummary = {};

  const resolution = dominant(
    withInfo.map((file) => normaliseResolution(file.mediaInfo?.resolution))
  );
  if (resolution) summary.resolution = resolution;

  const videoCodec = dominant(withInfo.map((file) => file.mediaInfo?.videoCodec || undefined));
  if (videoCodec) summary.videoCodec = videoCodec;

  const audioCodec = dominant(withInfo.map((file) => file.mediaInfo?.audioCodec || undefined));
  if (audioCodec) summary.audioCodec = audioCodec;

  const bitrates = withInfo
    .map((file) => file.mediaInfo?.videoBitrate)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  if (bitrates.length > 0) {
    summary.bitrate = Math.round(bitrates.reduce((a, b) => a + b, 0) / bitrates.length);
  }

  return summary;
}

// TMDB serves posters at fixed widths via `/t/p/<size>/...`. The data we get
// from Radarr embeds `/t/p/original/` URLs (often 2000×2800), which is wasteful
// for the 160×240 list tiles we render. w342 comfortably covers a 2x DPR tile
// and cuts per-poster bytes by ~95%.
const TMDB_ORIGINAL = '/t/p/original/';
const TMDB_THUMB = '/t/p/w342/';

export function toThumbnailUrl<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  if (url.includes('image.tmdb.org') && url.includes(TMDB_ORIGINAL)) {
    return url.replace(TMDB_ORIGINAL, TMDB_THUMB) as T;
  }
  return url;
}

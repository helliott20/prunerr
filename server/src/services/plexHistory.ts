/**
 * Plex watch history.
 *
 * The implementation is backend-agnostic and now lives in
 * `mediaServerHistory.ts`; this module remains as the Plex-named entry point so
 * existing imports keep working.
 */
import { MediaServerHistoryService } from './mediaServerHistory';

export { MediaServerHistoryService };

/** @deprecated Use `MediaServerHistoryService`. */
export const PlexHistoryService = MediaServerHistoryService;
/** @deprecated Use `MediaServerHistoryService`. */
export type PlexHistoryService = MediaServerHistoryService;

export default MediaServerHistoryService;

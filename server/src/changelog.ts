/**
 * The changelog that ships inside the image.
 *
 * This is what the "What's new" panel falls back to when the remote feed is
 * unreachable, switched off, or empty — so a fresh install with no internet
 * access still gets a summary of the release it is running. Newest first.
 *
 * Add an entry here as part of cutting a release, alongside the tag and the
 * CasaOS manifest bump. The `version` must match the tag (without the `v`);
 * the panel treats the entry whose version equals the running version as the
 * one to pop open once after an upgrade.
 */

export interface ChangelogEntry {
  /** The release this describes, e.g. "1.8.0". */
  version: string;
  /** ISO date the release was published. */
  date: string;
  /** One-line headline. */
  title: string;
  /**
   * Plain text. Line breaks are kept; a blank line starts a new paragraph.
   * Lines starting with "- " render as a bulleted list.
   */
  body: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.8.0',
    date: '2026-09-22',
    title: "What's new, right in the sidebar",
    body:
      "Prunerr now tells you what changed. A What's new button in the sidebar opens a panel with the release notes for the version you are running, plus occasional announcements and requests for feedback.\n\n" +
      '- Announcements arrive without an update. They come from the same endpoint as the anonymous install count, so the Privacy toggle switches both off together.\n' +
      '- Nothing about you is sent. The request carries the version number and nothing else, so an announcement can be aimed at a specific release.\n' +
      '- Offline installs still see the release notes, which are built into the image.',
  },
  {
    version: '1.7.2',
    date: '2026-09-20',
    title: 'Page scroll resets on navigation',
    body: 'Moving between pages now starts at the top, and going back restores where you were.',
  },
  {
    version: '1.7.1',
    date: '2026-09-20',
    title: 'Light-mode contrast and rule attribution',
    body:
      '- Better contrast across the light theme.\n' +
      '- TV shows now show resolution and codec alongside movies.\n' +
      '- The queue says which rule put an item there, with links through to the rule and the item.',
  },
  {
    version: '1.7.0',
    date: '2026-09-16',
    title: 'Episode-level control for TV shows',
    body:
      'The TV show page opens the series up: every season, every episode, what Sonarr has on disk and what it does not.\n\n' +
      '- A Sonarr panel on the show page, season by season, with per-episode state, file size, quality and release group.\n' +
      '- Delete episodes and seasons individually, now or through the usual grace period. Deleting a season can unmonitor it in Sonarr.\n' +
      '- Select across seasons with shift-click ranges.\n' +
      '- Downloads show up in the activity timeline, grouped when several land together.\n' +
      '- A beta channel: pull helliott20/prunerr:beta, or pick Beta from the Unraid template.\n' +
      '- Tabbed detail page with the poster colour washed across it, and a shorter cover on phones.',
  },
];

import type { MediaItem, Rule } from '../types';

/**
 * Check whether a rule's targeting scope (media type + Plex libraries)
 * covers a media item. This runs BEFORE condition evaluation — an item
 * outside the rule's scope is never evaluated against its conditions.
 *
 * Library targeting semantics:
 * - `library_keys` null/empty → the rule applies to every library.
 * - Otherwise the item's `library_key` must be one of the targeted keys.
 *   Items with no library_key (legacy rows synced before the column
 *   existed) are treated as out of scope for library-restricted rules,
 *   so a targeted rule never deletes content whose library is unknown.
 */
export function ruleScopeMatches(rule: Rule, item: MediaItem): boolean {
  const ruleMediaType = rule.media_type || 'all';
  if (ruleMediaType !== 'all' && ruleMediaType !== item.type) {
    return false;
  }

  const libraryKeys = rule.library_keys;
  if (libraryKeys && libraryKeys.length > 0) {
    if (!item.library_key) return false;
    return libraryKeys.includes(item.library_key);
  }

  return true;
}

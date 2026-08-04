import { describe, it, expect } from 'vitest';
import { extractRatingKey } from '../tracearr';

describe('extractRatingKey', () => {
  describe('Plex thumb paths', () => {
    it('extracts the rating key from a metadata path', () => {
      expect(extractRatingKey('/library/metadata/12345/thumb/1699999999')).toBe('12345');
    });

    it('extracts the rating key when the path has no trailing segments', () => {
      expect(extractRatingKey('/library/metadata/98765')).toBe('98765');
    });
  });

  describe('Jellyfin and Emby image paths', () => {
    // Jellyfin/Emby serve artwork from /Items/{itemId}/Images/Primary, and the
    // item id is the same GUID the media server abstraction stores as ratingKey.
    it('extracts the item id from a Jellyfin image path', () => {
      expect(extractRatingKey('/Items/a1b2c3d4e5f6478899aabbccddeeff00/Images/Primary')).toBe(
        'a1b2c3d4e5f6478899aabbccddeeff00'
      );
    });

    it('extracts the item id from an absolute URL', () => {
      expect(
        extractRatingKey('http://jellyfin:8096/Items/0f8fad5bd9cb469fa16570867728950e/Images/Primary?tag=abc')
      ).toBe('0f8fad5bd9cb469fa16570867728950e');
    });

    it('matches the Items segment case-insensitively', () => {
      expect(extractRatingKey('/items/0f8fad5bd9cb469fa16570867728950e/images/primary')).toBe(
        '0f8fad5bd9cb469fa16570867728950e'
      );
    });
  });

  describe('unusable paths', () => {
    it('returns null when the path is undefined', () => {
      expect(extractRatingKey(undefined)).toBeNull();
    });

    it('returns null when the path is empty', () => {
      expect(extractRatingKey('')).toBeNull();
    });

    it('returns null when no known segment is present', () => {
      expect(extractRatingKey('/some/unrelated/path.jpg')).toBeNull();
    });

    it('returns null when the marker segment has no id after it', () => {
      expect(extractRatingKey('/library/metadata/')).toBeNull();
      expect(extractRatingKey('/Items/')).toBeNull();
    });
  });
});

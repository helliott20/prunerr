import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../text';

describe('decodeHtmlEntities', () => {
  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('Wuthering Heights')).toBe('Wuthering Heights');
  });

  it('decodes numeric decimal entities', () => {
    expect(decodeHtmlEntities('&#34;Wuthering Heights&#34;')).toBe('"Wuthering Heights"');
  });

  it('decodes numeric hex entities', () => {
    expect(decodeHtmlEntities('&#x22;Wuthering Heights&#x22;')).toBe('"Wuthering Heights"');
  });

  it('decodes named entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeHtmlEntities('&quot;hi&quot;')).toBe('"hi"');
    expect(decodeHtmlEntities('it&apos;s')).toBe("it's");
  });

  it('handles French accented characters via numeric entities', () => {
    expect(decodeHtmlEntities('Caf&#233;')).toBe('Café');
  });

  it('is idempotent on already-clean strings', () => {
    const clean = '"Wuthering Heights"';
    expect(decodeHtmlEntities(clean)).toBe(clean);
  });

  it('preserves unknown entities verbatim', () => {
    expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
  });

  it('returns empty string unchanged', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

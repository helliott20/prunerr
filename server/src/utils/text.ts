const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input;
  return input.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (match, dec: string | undefined, hex: string | undefined, name: string | undefined): string => {
    try {
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (name) {
        const resolved = NAMED_ENTITIES[name.toLowerCase()];
        if (resolved !== undefined) return resolved;
      }
    } catch {
      // Malformed code point falls through to original match
    }
    return match;
  });
}

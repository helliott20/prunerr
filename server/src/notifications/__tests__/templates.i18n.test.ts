import { describe, it, expect } from 'vitest';
import { getPlainTextMessage, getDiscordMessage } from '../templates';
import en from '../../locales/en.json';
import es from '../../locales/es.json';

// Recursively collect every leaf key path so we can assert the two catalogs
// stay structurally identical — a missing Spanish key would otherwise fall
// back to English silently.
function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...leafKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('notification catalog parity', () => {
  it('en.json and es.json have identical key sets', () => {
    const enKeys = leafKeys(en as Record<string, unknown>).sort();
    const esKeys = leafKeys(es as Record<string, unknown>).sort();
    expect(esKeys).toEqual(enKeys);
  });
});

describe('getPlainTextMessage localization', () => {
  it('renders English by default and for unknown languages (fallback)', () => {
    const data = { itemsDeleted: 3, spaceFreedGB: '1.0', errors: 0 };
    expect(getPlainTextMessage('DELETION_COMPLETE', data)).toContain('Deletion Complete');
    expect(getPlainTextMessage('DELETION_COMPLETE', data, 'fr')).toContain('Deletion Complete');
  });

  it('renders Spanish when requested', () => {
    const msg = getPlainTextMessage('DELETION_COMPLETE', { itemsDeleted: 3, spaceFreedGB: '1.0', errors: 0 }, 'es');
    expect(msg).toContain('Eliminación completada');
    expect(msg).toContain('Espacio liberado: 1.0 GB');
  });

  it('applies correct plural forms (count = 1 vs many) in Spanish', () => {
    const one = getPlainTextMessage('DELETION_IMMINENT', {
      count: 1,
      urgency: 'low',
      items: [{ id: 1, title: 'Movie', daysRemaining: 1 }],
    }, 'es');
    const many = getPlainTextMessage('DELETION_IMMINENT', {
      count: 2,
      urgency: 'low',
      items: [{ id: 1, title: 'A', daysRemaining: 3 }, { id: 2, title: 'B', daysRemaining: 3 }],
    }, 'es');

    expect(one).toContain('1 elemento pendiente de eliminación');
    expect(one).toContain('1 día restante');
    expect(many).toContain('2 elementos pendientes de eliminación');
    expect(many).toContain('3 días restantes');
  });
});

describe('getDiscordMessage localization', () => {
  it('localizes the embed title and footer (brand) in Spanish', () => {
    const msg = getDiscordMessage('SCAN_COMPLETE', {
      itemsScanned: 100,
      itemsFlagged: 5,
      itemsProtected: 10,
      durationMs: 1234,
    }, 'es');
    expect(msg.embeds?.[0]?.title).toBe('⚡ Análisis de biblioteca — 5 elementos marcados');
    expect(msg.embeds?.[0]?.footer?.text).toBe('Prunerr');
  });

  it('falls back to English for an unknown language', () => {
    const msg = getDiscordMessage('SCAN_COMPLETE', {
      itemsScanned: 1,
      itemsFlagged: 0,
      itemsProtected: 0,
      durationMs: 50,
    }, 'de');
    expect(msg.embeds?.[0]?.title).toBe('✅ Library Scan Complete');
  });
});

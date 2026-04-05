import { describe, it, expect } from 'vitest';
import {
  FIELD_CATALOG,
  getField,
  getOperatorsForField,
  operatorNeedsValue,
  OPERATOR_LABELS,
  NO_VALUE_OPERATORS,
} from '../FieldCatalog';

describe('FieldCatalog', () => {
  it('has at least 25 fields', () => {
    expect(FIELD_CATALOG.length).toBeGreaterThanOrEqual(25);
  });

  it('has unique field ids', () => {
    const ids = FIELD_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every field has at least one operator', () => {
    for (const f of FIELD_CATALOG) {
      expect(f.operators.length).toBeGreaterThan(0);
    }
  });

  it('every operator has a human label', () => {
    for (const f of FIELD_CATALOG) {
      for (const op of f.operators) {
        expect(OPERATOR_LABELS[op]).toBeTruthy();
      }
    }
  });

  describe('getField', () => {
    it('returns the catalog entry for a known field', () => {
      const def = getField('days_since_watched');
      expect(def?.label).toBe('Days since last watched');
      expect(def?.operators).toContain('greater_than');
    });

    it('returns undefined for unknown field', () => {
      expect(getField('not_real')).toBeUndefined();
    });
  });

  describe('getOperatorsForField', () => {
    it('returns operators for a known field', () => {
      expect(getOperatorsForField('title')).toContain('contains');
    });

    it('returns empty array for unknown field', () => {
      expect(getOperatorsForField('nope')).toEqual([]);
    });
  });

  describe('operatorNeedsValue', () => {
    it('returns false for no-value operators', () => {
      for (const op of NO_VALUE_OPERATORS) {
        expect(operatorNeedsValue(op)).toBe(false);
      }
    });

    it('returns true for value operators', () => {
      expect(operatorNeedsValue('equals')).toBe(true);
      expect(operatorNeedsValue('greater_than')).toBe(true);
      expect(operatorNeedsValue('contains_any')).toBe(true);
    });
  });

  describe('collection & user fields', () => {
    it('collection_membership uses collection-specific operators', () => {
      const def = getField('collection_membership');
      expect(def?.valueType).toBe('collection');
      expect(def?.operators).toContain('in_any_protected');
    });

    it('watched_by_user uses user-specific operators', () => {
      const def = getField('watched_by_user');
      expect(def?.valueType).toBe('user');
      expect(def?.operators).toContain('watched_since');
      expect(def?.operators).toContain('ever_watched');
    });
  });

  describe('list fields', () => {
    it('genres and tags use list operators', () => {
      expect(getField('genres')?.operators).toContain('contains_any');
      expect(getField('tags')?.operators).toContain('contains_all');
    });
  });
});

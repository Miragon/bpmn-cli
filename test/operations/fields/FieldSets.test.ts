import { describe, expect, it } from 'vitest';
import { FieldSets } from '../../../src/operations/fields/FieldSets.js';

describe('FieldSets', () => {
  it('keeps the five places of a node together', () => {
    expect(Object.keys(FieldSets.placement)).toEqual(['after', 'before', 'flow', 'in', 'on']);
  });

  it('forbids every pair of places but after with before', () => {
    const pairs = FieldSets.placementRules.map(({ not }) => not.required.join());
    expect(pairs).toHaveLength(9);
    expect(pairs).not.toContain('after,before');
  });

  it('marks the alias of what an element references as batch only', () => {
    expect(FieldSets.refAs.jsonSchema()['x-batch-only']).toBe(true);
    expect(FieldSets.kind.traits.required).toBe(true);
  });
});

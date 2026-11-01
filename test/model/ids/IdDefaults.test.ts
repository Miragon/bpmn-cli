import { describe, expect, it } from 'vitest';
import { IdDefaults } from '../../../src/model/ids/IdDefaults.js';
import { IdSlug } from '../../../src/model/ids/IdSlug.js';
import { Kinds } from '../../../src/model/kinds/Kinds.js';

describe('IdDefaults', () => {
  it('declares a usable camelCase prefix for the type of every kind', () => {
    for (const definition of Kinds.ALL) {
      expect(IdSlug.isUsablePrefix(IdDefaults.CONVENTIONS.prefixes[definition.type]), definition.type).toBe(true);
    }
    expect(IdDefaults.CONVENTIONS.case).toBe('camelCase');
  });

  it('qualifies a prefix only by a trigger its event may have', () => {
    const qualified = Object.keys(IdDefaults.CONVENTIONS.prefixes).filter((key) => key.split(':').length === 3);

    expect(qualified.length).toBeGreaterThan(0);
    for (const key of qualified) {
      const [prefix, local, trigger] = key.split(':');
      const definition = Kinds.ALL.find((candidate) => candidate.type === `${prefix}:${local}`);
      expect(definition?.triggers, key).toContain(trigger);
    }
  });

  it('gives the data behind a reference its own prefix, so both can share a name', () => {
    expect(IdDefaults.UNCHECKED_PREFIXES['bpmn:DataObject']).not.toBe(IdDefaults.CONVENTIONS.prefixes['bpmn:DataObjectReference']);
  });
});

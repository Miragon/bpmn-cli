import { describe, expect, it } from 'vitest';
import type { Rename } from '../../src/model/index.js';
import { IdRenames } from '../../src/write/IdRenames.js';
import { ChangeSet } from '../support/ModelValues.js';

const renames = (list: Rename[], created: string[] = []): IdRenames => {
  const changes = new ChangeSet();
  changes.renames.push(...list);
  created.forEach((id) => changes.create({ id, kind: 'task' }));
  return new IdRenames(changes);
};

describe('IdRenames', () => {
  it('reads a chain of renames as one', () => {
    expect(renames([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]).list()).toEqual([{ from: 'a', to: 'c' }]);
  });

  it('drops a rename that ends where it began', () => {
    expect(renames([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).list()).toEqual([]);
  });

  it('leaves out an element the change created', () => {
    expect(renames([{ from: 'draft', to: 'task' }], ['task']).list()).toEqual([]);
  });

  it('marks a takeover and stops the chain that led to it', () => {
    const taken = renames([{ from: 'a', to: 'b' }, { from: 'b', to: 'gone', takeover: true }]);

    expect(taken.list()).toEqual([{ from: 'b', to: 'gone', takeover: true }]);
    expect(taken.newIds().size).toBe(0);
  });

  it('answers the old id of a renamed element and any other id as it is', () => {
    expect(renames([{ from: 'old', to: 'new' }]).oldIdsOf(['new', 'same'])).toEqual(['old', 'same']);
  });
});

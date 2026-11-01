import { describe, expect, it } from 'vitest';
import { DrawnElementIds } from '../../../src/drawing/diagram/DrawnElementIds.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DrawnElementIds', () => {
  it('gives every drawn element without id one, connections last', async () => {
    const document = await Fixtures.read('drawing/idless.bpmn');

    const given = new DrawnElementIds(document).give();

    expect(given.map(({ kind }) => kind).sort()).toEqual(['sequenceFlow', 'task', 'textAnnotation']);
    expect(given.at(-1)!.kind).toBe('sequenceFlow');
    expect(given.find(({ kind }) => kind === 'task')!.name).toBe('Check invoice');
    expect(given.every(({ id }) => document.tree.has(id))).toBe(true);
  });

  it('names a flow after its ends', async () => {
    const document = await Fixtures.read('drawing/idless.bpmn');

    const flow = new DrawnElementIds(document).give().at(-1)!;

    expect(flow.id.toLowerCase()).toContain('start');
  });

  it('gives nothing when every element has an id', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(new DrawnElementIds(document).give()).toEqual([]);
  });
});

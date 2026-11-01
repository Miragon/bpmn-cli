import { describe, expect, it } from 'vitest';
import { FlowEnds } from '../../../src/model/kinds/FlowEnds.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowEnds', () => {
  it('reads the source and the target of a connected flow', async () => {
    const { tree } = await Fixtures.read('edit/dangling-references.bpmn');
    const ends = new FlowEnds(tree.require('flow_ok'));

    expect([ends.source.id, ends.target.id]).toEqual(['start', 'first']);
  });

  it.each([
    ['source', 'flow_noSource'],
    ['target', 'flow_noTarget'],
  ] as const)('refuses a flow that has no %s and names how to repair it', async (end, id) => {
    const { tree } = await Fixtures.read('edit/dangling-references.bpmn');

    expect(() => new FlowEnds(tree.require(id))[end]).toThrow(expect.objectContaining({ code: 'E_DANGLING_REF', message: `${id} has no ${end} (unresolved reference)`, details: expect.objectContaining({ element: id, hint: expect.stringContaining(`bpmn remove <file> ${id}`) }) }));
  });
});

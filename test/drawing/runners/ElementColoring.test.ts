import { describe, expect, it } from 'vitest';
import { ElementColoring } from '../../../src/drawing/runners/ElementColoring.js';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementColoring', () => {
  async function drawn(path: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(path));
  }

  it('colours a shape and a flow and declares the namespaces of the colours', async () => {
    const diagram = await drawn('drawing/runners/branching.bpmn');

    expect(new ElementColoring(diagram, { op: 'color', ids: ['A', 'F_yes', 'A'], color: 'red' }).run()).toEqual(['A', 'F_yes']);
    expect(diagram.document.namespaces.prefixFor('http://bpmn.io/schema/bpmn/biocolor/1.0')).toBe('bioc');
  });

  it('reports no change on a second colouring and none on removing a colour nothing has', async () => {
    const diagram = await drawn('drawing/runners/branching.bpmn');
    new ElementColoring(diagram, { op: 'color', ids: ['A'], color: 'red' }).run();

    expect(new ElementColoring(diagram, { op: 'color', ids: ['A'], color: 'red' }).run()).toEqual([]);
    expect(new ElementColoring(diagram, { op: 'color', ids: ['G'], color: 'default' }).run()).toEqual([]);
  });

  it('colours a pool and a lane', async () => {
    const diagram = await drawn('drawing/runners/lanes.bpmn');

    expect(new ElementColoring(diagram, { op: 'color', ids: ['Pool', 'L1'], color: 'orange' }).run()).toEqual(['Pool', 'L1']);
  });

  it('refuses the process of a pool and a file without diagram', async () => {
    const pooled = await drawn('drawing/runners/lanes.bpmn');
    const bare = await drawn('drawing/idless.bpmn');
    const processId = bare.document.tree.processes()[0]!.peek<string>('id') ?? '';

    expect(() => new ElementColoring(pooled, { op: 'color', ids: ['P'], color: 'blue' }).run()).toThrow(expect.objectContaining({ code: 'E_NO_SHAPE' }));
    expect(() => new ElementColoring(bare, { op: 'color', ids: [processId], color: 'blue' }).run()).toThrow(expect.objectContaining({ code: 'E_NO_DIAGRAM' }));
  });
});

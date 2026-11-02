import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { ElementSelector, type SelectionView } from '../../../src/drawing/runners/ElementSelector.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementSelector', () => {
  async function selector(name: string): Promise<{ selector: ElementSelector; view: SelectionView }> {
    const document = await Fixtures.read(`drawing/runners/${name}.bpmn`);
    const { planes } = new DrawnDiagram(document);
    const centreX = (id: string): number | undefined => planes[0]!.shapes.get(id)?.bounds.center.x;
    return { selector: new ElementSelector(document), view: { shapesOnly: false, drawn: (id) => planes[0]!.shapes.has(id) || planes[0]!.edges.has(id), centreX } };
  }

  const idsOf = (elements: readonly { id: string }[]): string[] => elements.map(({ id }) => id);

  it('walks the shortest path from a start event to an end event, nodes and flows', async () => {
    const { selector: selected } = await selector('branching');

    expect(idsOf(selected.path('S', 'E2'))).toEqual(expect.arrayContaining(['S', 'A', 'G', 'F_no', 'C', 'E2']));
    expect(idsOf(selected.path('S', 'E2'))).not.toContain('B');
  });

  it('finds no path against the flow direction', async () => {
    const { selector: selected } = await selector('split');

    expect(() => selected.path('End', 'S')).toThrow(expect.objectContaining({ code: 'E_NO_MATCH', details: expect.objectContaining({ element: 'S' }) }));
  });

  it('a path from a node to itself is that node', async () => {
    const { selector: selected } = await selector('branching');

    expect(idsOf(selected.path('A', 'A'))).toEqual(['A']);
  });

  it('follows the boundary event of an activity on a path', async () => {
    const { selector: selected } = await selector('boundary-path');

    expect(idsOf(selected.path('A', 'TE'))).toEqual(expect.arrayContaining(['TB', 'R', 'TE']));
  });

  it('takes what only a branch reaches, up to the join', async () => {
    const { selector: selected, view } = await selector('split');

    const branch = idsOf(selected.branch('F_a', view.centreX));

    expect(branch).toEqual(expect.arrayContaining(['F_a', 'A1', 'A2']));
    expect(branch).not.toContain('J');
    expect(branch).not.toContain('B1');
  });

  it('refuses a branch that runs straight into the join', async () => {
    const { selector: selected, view } = await selector('split');

    expect(() => selected.branch('F_c', view.centreX)).toThrow(expect.objectContaining({ code: 'E_NO_MATCH' }));
  });

  it('leaves connections and boundary events out of what shapes are moved by', async () => {
    const { selector: selected, view } = await selector('boundary-path');

    const picked = selected.select({ path: ['A', 'TE'] }, { ...view, shapesOnly: true });

    expect(picked).toEqual(expect.arrayContaining(['A', 'R', 'TE']));
    expect(picked).not.toContain('TB');
  });

  it('keeps given ids first and adds each element once', async () => {
    const { selector: selected, view } = await selector('branching');

    expect(selected.select({ ids: ['E'], path: ['B', 'E'] }, { ...view, shapesOnly: true })).toEqual(['E', 'B']);
  });

  it('refuses a selection that reaches nothing drawn', async () => {
    const { selector: selected, view } = await selector('branching');

    expect(() => selected.select({ path: ['S', 'E'] }, { ...view, drawn: () => false })).toThrow(expect.objectContaining({ code: 'E_NO_MATCH' }));
  });
});

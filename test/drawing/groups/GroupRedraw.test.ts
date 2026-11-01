import { describe, expect, it } from 'vitest';
import { GroupRedraw } from '../../../src/drawing/groups/GroupRedraw.js';
import { GroupShapes, type RememberedGroup } from '../../../src/drawing/groups/GroupShapes.js';
import { Groups } from '../../../src/drawing/groups/Groups.js';
import { Box, type BpmnDocument, type BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('GroupRedraw', () => {
  function withoutGroupShapes(document: BpmnDocument): BpmnElement {
    const plane = document.diagram.planes()[0]!;
    for (const shape of plane.list('planeElement').filter((element) => element.peek<BpmnElement>('bpmnElement')?.is('bpmn:Group'))) {
      plane.remove('planeElement', shape);
    }
    return plane;
  }

  function redraw(document: BpmnDocument, groups: readonly RememberedGroup[]) {
    return new GroupRedraw(document.tree, new GroupShapes(document.tree.definitions), (id) => `shape_of_${id}`).run(groups);
  }

  it('skips a group that is already drawn and draws nothing without groups', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');

    expect(redraw(document, new Groups(document.tree).remembered())).toEqual({ drawn: [], kept: [], moved: [] });
    expect(redraw(document, [])).toEqual({ drawn: [], kept: [], moved: [] });
  });

  it('keeps a group around nothing at its old box while that is free', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const remembered = new Groups(document.tree).remembered().filter(({ id }) => id === 'around_nothing');
    const plane = withoutGroupShapes(document);

    const result = redraw(document, remembered);

    expect(result).toEqual({ drawn: [], kept: ['around_nothing'], moved: [] });
    expect(GroupShapes.items(plane).get('around_nothing')?.box).toMatchObject({ x: 100, y: 400 });
  });

  it('moves a group around nothing below the drawing when shapes lie on its old box', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const plane = withoutGroupShapes(document);
    const blocked = { id: 'around_nothing', root: 'process', bounds: new Box(100, 100, 100, 80), label: new Box(110, 110, 40, 14), members: [] };

    const result = redraw(document, [blocked]);

    expect(result.moved).toEqual(['around_nothing']);
    expect(GroupShapes.items(plane).get('around_nothing')!.box.y).toBeGreaterThan(180);
  });

  it('stacks two moved groups', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const plane = withoutGroupShapes(document);
    const first = { id: 'around_nothing', root: 'process', bounds: new Box(100, 100, 100, 80), members: [] };
    const second = { id: 'on_a_shape', root: 'process', bounds: new Box(100, 100, 100, 80), members: [] };

    redraw(document, [first, second]);

    const items = GroupShapes.items(plane);
    expect(items.get('around_nothing')!.box.overlaps(items.get('on_a_shape')!.box)).toBe(false);
  });

  it('forgets a group around nothing without a box', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    withoutGroupShapes(document);

    expect(redraw(document, [{ id: 'around_nothing', bounds: new Box(0, 0, 0, 0), members: [] }])).toEqual({ drawn: [], kept: [], moved: [] });
  });

  it('labels a named group and fits a group inside another first', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const plane = withoutGroupShapes(document);
    const inner = { id: 'named_group', root: 'process', bounds: new Box(0, 0, 10, 10), label: new Box(0, 0, 40, 14), members: ['member'] };
    const outer = { id: 'on_a_shape', root: 'process', bounds: new Box(0, 0, 500, 500), members: ['named_group', 'task'] };

    const result = redraw(document, [outer, inner]);

    const items = GroupShapes.items(plane);
    expect(result.drawn).toEqual(['named_group', 'on_a_shape']);
    expect(items.get('named_group')!.label).toBeDefined();
    expect(items.get('named_group')!.box.isInside(items.get('on_a_shape')!.box)).toBe(true);
  });
});

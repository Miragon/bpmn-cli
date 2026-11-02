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

  it('measures the drawing with its lines and their labels when a kept group moves', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');
    const plane = withoutGroupShapes(document);
    const lowest = Math.max(...plane.list('planeElement').flatMap((element) => element.list('waypoint').map((waypoint) => waypoint.peek<number>('y') ?? 0)));
    const blocked = { id: 'G1', root: 'P1', bounds: new Box(GroupShapes.items(plane).get('A')!.box.x, GroupShapes.items(plane).get('A')!.box.y, 100, 80), members: [] };

    expect(redraw(document, [blocked]).moved).toEqual(['G1']);
    expect(GroupShapes.items(plane).get('G1')!.box.y).toBeGreaterThan(lowest);
  });

  it('fits a group again when a group drawn later lies inside it', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const plane = withoutGroupShapes(document);
    const first = { id: 'named_group', root: 'process', bounds: new Box(0, 0, 10, 10), members: ['task', 'member', 'fresh_member'] };
    const second = { id: 'on_a_shape', root: 'process', bounds: new Box(0, 0, 20, 20), members: ['member'] };

    const result = redraw(document, [second, first]);

    const items = GroupShapes.items(plane);
    expect(result.drawn).toHaveLength(2);
    expect(items.get('on_a_shape')!.box.isInside(items.get('named_group')!.box)).toBe(true);
  });

  it('goes to the plane holding most members, the old root on a tie', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const group = document.tree.build('bpmn:Group', { id: 'fresh_group' });
    Fixtures.element(document, 'P1').add('artifacts', group);

    const result = redraw(document, [{ id: 'fresh_group', root: 'P1', bounds: new Box(0, 0, 10, 10), members: ['A'] }]);

    expect(result.drawn).toEqual(['fresh_group']);
    expect(GroupShapes.items(document.diagram.planes()[1]).has('fresh_group')).toBe(true);
  });
});

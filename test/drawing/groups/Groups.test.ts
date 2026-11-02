import { describe, expect, it } from 'vitest';
import { GroupShapes } from '../../../src/drawing/groups/GroupShapes.js';
import { Groups } from '../../../src/drawing/groups/Groups.js';
import { Box, type BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Groups', () => {
  it('remembers a group with the shapes in its box', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');

    const remembered = new Groups(document.tree).remembered();

    expect(remembered.map(({ id }) => id)).toEqual(['G1', 'G2']);
    expect(remembered[0]!.members.length).toBeGreaterThan(0);
    expect(remembered[0]!.root).toBe('P1');
  });

  it('remembers members by category value before the box', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    Fixtures.element(document, 'member').add('categoryValueRef', Fixtures.element(document, 'named_group').peek<BpmnElement>('categoryValueRef')!);

    const named = new Groups(document.tree).remembered().find(({ id }) => id === 'named_group')!;

    expect(named.members).toEqual(['member']);
  });

  it('lists a group that has no shape yet but members', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const value = Fixtures.element(document, 'named_group').peek<BpmnElement>('categoryValueRef')!;
    Fixtures.element(document, 'fresh_member').add('categoryValueRef', value);
    Fixtures.element(document, 'on_a_shape').set('categoryValueRef', value);

    const [undrawn] = new Groups(document.tree).undrawn();

    expect(undrawn).toMatchObject({ id: 'on_a_shape', members: ['fresh_member'] });
    expect(undrawn!.label).toBeInstanceOf(Box);
  });

  it('orders the groups of an element outermost first', () => {
    const inner = { id: 'inner', bounds: new Box(0, 0, 10, 10), members: ['a'] };
    const outer = { id: 'outer', bounds: new Box(0, 0, 100, 100), members: ['a'] };

    expect(Groups.membersOf([inner, outer]).get('a')).toEqual(['outer', 'inner']);
  });

  it('relabels a renamed group at the top of its box, and takes the label off an emptied one', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');
    const groups = new Groups(document.tree);
    const group = Fixtures.element(document, 'named_group');
    const shape = document.diagram.planes()[0]!.list('planeElement').find((element) => element.peek('bpmnElement') === group)!;

    groups.relabel(group, 'Accounting');
    expect(shape.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds')?.peek('y')).toBeGreaterThanOrEqual(60);

    groups.relabel(group, ' ');
    expect(shape.peek('label')).toBeUndefined();
  });

  it('draws a group again around where its members went', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');
    const groups = new Groups(document.tree);
    const remembered = groups.remembered();
    const plane = document.diagram.planes()[0]!;
    for (const shape of plane.list('planeElement').filter((element) => element.peek<BpmnElement>('bpmnElement')?.is('bpmn:Group'))) {
      plane.remove('planeElement', shape);
    }

    const redrawn = groups.redraw(remembered);

    expect([...redrawn.drawn].sort()).toEqual(['G1', 'G2']);
    expect(plane.list('planeElement').filter((element) => element.peek<BpmnElement>('bpmnElement')?.is('bpmn:Group'))).toHaveLength(2);
    expect(GroupShapes.items(plane).get('G1')!.box.width).toBeGreaterThan(0);
  });
});

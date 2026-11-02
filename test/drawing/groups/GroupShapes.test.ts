import { describe, expect, it } from 'vitest';
import { GroupShapes } from '../../../src/drawing/groups/GroupShapes.js';
import { Box, type BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('GroupShapes', () => {
  it('reads each shape of a plane once, the first DI wins', async () => {
    const document = await Fixtures.read('models/incremental/lanesub.bpmn');

    const items = GroupShapes.items(document.diagram.planes()[0]);

    expect(items.get('Pool')?.whole).toBe(true);
    expect(items.get('SP')?.whole).toBe(true);
    expect(items.get('T1')?.whole).toBe(false);
    expect(GroupShapes.items(undefined).size).toBe(0);
  });

  it('knows the host of a boundary event', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(GroupShapes.items(document.diagram.planes()[0]).get('B')?.host).toBe('A');
  });

  it('holds a leaf by its centre and a frame only whole', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const item = GroupShapes.items(document.diagram.planes()[0]).get('A')!;
    const halfOver = new Box(item.box.x - 10, item.box.y - 10, item.box.width / 2 + 20, item.box.height + 20);

    expect(GroupShapes.holds(halfOver, item)).toBe(true);
    expect(GroupShapes.holds(halfOver, { ...item, whole: true })).toBe(false);
  });

  it('finds the groups and the members of their category values', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');
    const shapes = new GroupShapes(document.tree.definitions);

    expect([...shapes.groupElements().keys()]).toEqual(['G1', 'G2']);
    expect(shapes.planes()).toHaveLength(1);
    expect(shapes.categoryMembers()).toBeInstanceOf(Map);
  });

  it('measures the area of a remembered group', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');
    const group: BpmnElement = Fixtures.element(document, 'G1');

    expect(GroupShapes.areaOf({ id: group.id, bounds: new Box(0, 0, 10, 20), members: [] })).toBe(200);
  });
});

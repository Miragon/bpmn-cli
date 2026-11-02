import { describe, expect, it } from 'vitest';
import { GroupFit } from '../../../src/drawing/groups/GroupFit.js';
import type { GroupItem } from '../../../src/drawing/groups/GroupShapes.js';
import { Box } from '../../support/ModelValues.js';
import { ScopeSketch } from '../../support/ScopeSketch.js';

describe('GroupFit', () => {
  function item(id: string, box: Box, extra: Partial<GroupItem> = {}): GroupItem {
    return { id, el: ScopeSketch.element('bpmn:Task', id), box, whole: false, ...extra };
  }

  function shapesOf(...items: GroupItem[]): Map<string, GroupItem> {
    return new Map(items.map((entry) => [entry.id, entry]));
  }

  it('pads the members by 20 px', () => {
    const shapes = shapesOf(item('a', new Box(100, 100, 100, 80)));

    expect(new GroupFit(shapes, 'group', 20).fit(new Set(['a']))).toMatchObject({ x: 80, y: 80, width: 140, height: 120 });
  });

  it('stops half-way to a neighbour on each side', () => {
    const shapes = shapesOf(item('a', new Box(100, 100, 100, 80)), item('right', new Box(210, 100, 100, 80)), item('left', new Box(0, 100, 90, 80)), item('above', new Box(100, 0, 100, 90)), item('below', new Box(100, 190, 100, 80)));

    expect(new GroupFit(shapes, 'group', 20).fit(new Set(['a']))).toMatchObject({ x: 95, y: 95, width: 110, height: 90 });
  });

  it('stays inside a frame around its members', () => {
    const shapes = shapesOf(item('a', new Box(100, 100, 100, 80)), item('lane', new Box(90, 90, 120, 100), { whole: true }));

    expect(new GroupFit(shapes, 'group', 20).fit(new Set(['a']))).toMatchObject({ x: 95, y: 95 });
  });

  it('takes a boundary event with its host, and a shape the box holds with its event', () => {
    const shapes = shapesOf(item('host', new Box(100, 100, 100, 80)), item('event', new Box(120, 162, 36, 36), { host: 'host' }));
    const ids = new Set(['host']);

    new GroupFit(shapes, 'group', 20).fit(ids);

    expect([...ids]).toEqual(['host', 'event']);
  });

  it('grows for a label only when that pulls no other shape in', () => {
    const shapes = shapesOf(item('a', new Box(100, 100, 100, 80), { label: new Box(100, 190, 40, 14) }), item('b', new Box(300, 100, 100, 80), { label: new Box(280, 190, 400, 14) }), item('c', new Box(500, 100, 100, 80)));

    expect(new GroupFit(shapes, 'group', 20).fit(new Set(['a'])).bottom).toBeGreaterThanOrEqual(204);
    expect(new GroupFit(shapes, 'group', 20).fit(new Set(['b'])).right).toBeLessThan(600);
  });

  it('centres a group label at the top of its box', () => {
    expect(GroupFit.labelOn(new Box(0, 100, 200, 100), { width: 40, height: 14 })).toMatchObject({ x: 80, y: 103 });
  });
});

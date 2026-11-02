import { describe, expect, it } from 'vitest';
import { MessageLegs, type MessageEnd, type MessagePool } from '../../../../src/drawing/full/links/MessageLegs.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('MessageLegs', () => {
  const task = ScopeSketch.element('bpmn:Task', 'task');
  const line = (...coordinates: Array<[number, number]>) => new Polyline(coordinates.map(([x, y]) => new Point(x, y))).segments();

  function poolWith(box: Box, obstacles: Box[] = [box], lines = line()): MessagePool {
    return { box: new Box(0, 0, 1000, 400), obstacles, lines, contentLeft: 30 };
  }

  const end = (box: Box, pool: MessagePool, own: Box[] = []): MessageEnd => ({ box, own, element: task, pool });

  it('leaves straight from the middle of a free border', () => {
    const box = new Box(300, 200, 100, 80);

    expect(new MessageLegs().legOf(end(box, poolWith(box)), true).x).toBe(350);
  });

  it('leaves beside the middle when a line lies on it', () => {
    const box = new Box(300, 200, 100, 80);

    expect(new MessageLegs().legOf(end(box, poolWith(box, [box], line([350, 0], [350, 200]))), true).x).toBe(325);
  });

  it('pays nothing for crossing the line of an annotation', () => {
    const box = new Box(300, 200, 100, 80);
    const blocked = line([350, 0], [350, 200]);
    const noteLine = line([300, 100], [330, 100]);
    const pool = poolWith(box, [box], [...blocked, ...noteLine]);

    expect(new MessageLegs().legOf(end(box, pool), true).x).toBe(375);
    expect(new MessageLegs().legOf(end(box, { ...pool, crossable: blocked }), true).x).toBe(325);
  });

  it('jogs through a corridor when a shape blocks every straight way up', () => {
    const box = new Box(300, 200, 100, 80);
    const wall = new Box(250, 50, 200, 80);

    const leg = new MessageLegs().legOf(end(box, poolWith(box, [box, wall])), true);

    expect(leg.points).toHaveLength(3);
    expect(leg.x < 250 || leg.x > 450).toBe(true);
  });

  it('clears the boundary events hanging out of the border it leaves', () => {
    const box = new Box(300, 200, 100, 80);
    const event = new Box(340, 262, 36, 36);
    const wall = new Box(250, 320, 200, 40);

    const leg = new MessageLegs().legOf(end(box, poolWith(box, [box, event, wall]), [event]), false);

    expect(leg.points[1]!.y).toBeGreaterThan(event.bottom);
  });

  it('counts what a straight way up meets, and running on a line as one more', () => {
    const box = new Box(300, 200, 100, 80);
    const wall = new Box(300, 50, 100, 80);
    const pool = poolWith(box, [box, wall], line([350, 0], [350, 200]));

    expect(new MessageLegs().straightHits(end(box, pool), pool, true)).toBe(2);
    expect(new MessageLegs().straightHits(end(box, pool), undefined, true)).toBe(0);
  });

  it('leaves a pool straight, whatever lies in it', () => {
    const box = new Box(0, 0, 1000, 400);
    const participant = ScopeSketch.element('bpmn:Participant', 'pool');
    const pool = poolWith(box);

    expect(new MessageLegs().legOf({ box, own: [], element: participant, pool }, false).points).toHaveLength(1);
  });
});

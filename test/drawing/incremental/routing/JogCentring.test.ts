import { describe, expect, it } from 'vitest';
import { JogCentring } from '../../../../src/drawing/incremental/routing/JogCentring.js';
import { RouteScene } from '../../../../src/drawing/incremental/routing/RouteScene.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('JogCentring', () => {
  const source = new Box(100, 100, 100, 80);
  const target = new Box(600, 300, 100, 80);
  const jog = [new Point(200, 140), new Point(250, 140), new Point(250, 340), new Point(600, 340)];

  function centred(obstacles: Box[], points: Point[] = jog): number[] {
    return new JogCentring(RouteScene.of({ source, target, obstacles })).centred(points).map(({ x }) => x);
  }

  it('moves a vertical jog into the middle of its room', () => {
    expect(centred([])).toEqual([200, 400, 400, 600]);
  });

  it('centres between an obstacle and the far end', () => {
    const late = [new Point(200, 140), new Point(450, 140), new Point(450, 340), new Point(600, 340)];

    expect(centred([new Box(280, 200, 100, 60)], late)[1]).toBe(490);
  });

  it('centres short of an obstacle on the far side', () => {
    expect(centred([new Box(420, 200, 100, 60)])[1]).toBe(310);
  });

  it('leaves a jog where an obstacle holds it on both sides', () => {
    expect(centred([new Box(240, 200, 100, 60)])[1]).toBe(250);
  });

  it('ignores obstacles beyond the jog', () => {
    expect(centred([new Box(300, 500, 100, 60)])[1]).toBe(400);
  });

  it('centres a horizontal jog on its axis', () => {
    const down = [new Point(150, 180), new Point(150, 200), new Point(650, 200), new Point(650, 300)];
    const ys = new JogCentring(RouteScene.of({ source, target, obstacles: [] })).centred(down).map(({ y }) => y);

    expect(ys[1]).toBe(240);
  });

  it('leaves a bend without a jog and a jog that turns back', () => {
    const corner = [new Point(200, 140), new Point(650, 140), new Point(650, 300)];
    const hook = [new Point(200, 140), new Point(260, 140), new Point(260, 340), new Point(220, 340)];

    expect(centred([], corner)).toEqual([200, 650, 650]);
    expect(centred([], hook)).toEqual([200, 260, 260, 220]);
  });

  it('keeps a jog whose move would add a crossing', () => {
    const crossed = RouteScene.of({ source, target, obstacles: [], lines: [[new Point(300, 150), new Point(500, 150)]] });

    expect(new JogCentring(crossed).centred(jog)[1]?.x).toBe(250);
  });

  it('leaves a jog already in the middle', () => {
    const middle = [new Point(200, 140), new Point(400, 140), new Point(400, 340), new Point(600, 340)];

    expect(centred([], middle)).toEqual([200, 400, 400, 600]);
  });

  it('leaves a jog with no room left between its stubs', () => {
    const tight = [new Point(200, 140), new Point(205, 140), new Point(205, 340), new Point(210, 340)];

    expect(centred([], tight)[1]).toBe(205);
  });
});

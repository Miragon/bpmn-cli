import { describe, expect, it } from 'vitest';
import { EdgeFollow } from '../../../../src/drawing/incremental/space/EdgeFollow.js';
import { SpacePass, type SpaceResult } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('EdgeFollow', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function follow(plane: Plane, result: Partial<SpaceResult>, overrides: Partial<ConstructorParameters<typeof SpacePass>[0]> = {}): void {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    const pass = new SpacePass({ plane, axis: 'x', line: 380, delta: 60, band: undefined, keep: new Set<string>(), before, held: undefined, push: undefined, scope: undefined, ...overrides });
    new EdgeFollow(pass, { moved: new Set(), resized: new Set(), ...result }).follow();
  }

  it('shifts the end on a moved shape and leaves the end on a shape that stayed', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    follow(plane, { moved: new Set(['C']) });

    expect(plane.edges.get('F2')!.points).toEqual([new Point(340, 120), new Point(460, 120)]);
  });

  it('shifts the end on a resized shape by the side of the line it lies on', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    follow(plane, { resized: new Set(['SP']) });

    expect(plane.edges.get('F2')!.points[0]!.x).toBe(700);
    expect(plane.edges.get('F1')!.points[1]!.x).toBe(240);
  });

  it('shifts bends beyond the line only inside the band', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    follow(plane, {}, { line: 500, band: [0, 100] });
    expect(plane.edges.get('f5')!.points[1]!.x).toBe(545);

    follow(plane, {}, { line: 500 });
    expect(plane.edges.get('f5')!.points[1]!.x).toBe(605);
  });

  it('keeps an edge between two kept shapes', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    follow(plane, {}, { line: 500, keep: new Set(['T2', 'J']) });

    expect(plane.edges.get('f5')!.points[1]!.x).toBe(545);
  });

  it('skips an edge outside the scoped frame', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const frame = plane.shapes.get('SP')!;
    follow(plane, {}, { line: 300, scope: { frame, ancestors: new Set(), grow: new Set() } });

    expect(plane.edges.get('F4')!.points[0]!.x).toBe(1040);
    expect(plane.edges.get('G2')!.points[0]!.x).toBe(620);
  });

  it('bends a line of a push only when it is listed or an end changed', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    follow(plane, {}, { line: 500, push: new Set() });
    expect(plane.edges.get('f5')!.points[1]!.x).toBe(545);

    follow(plane, {}, { line: 500, push: new Set(['f5']) });
    expect(plane.edges.get('f5')!.points[1]!.x).toBe(605);
  });

  it('carries a line inside a rigid block with the block', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const inner = plane.edges.get('G2')!;
    follow(plane, { moved: new Set(['SP', 'ST', 'SE']) }, { line: 500, held: new Set() });
    expect(inner.points.map(({ x }) => x)).toEqual([520, 582]);

    const stayed = await planeOf('models/incremental/sub.bpmn');
    follow(stayed, {}, { line: 500, held: new Set() });
    expect(stayed.edges.get('G2')!.points.map(({ x }) => x)).toEqual([460, 522]);
  });

  it('moves a label with the run it sits on', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f3')!;
    const x = edge.label!.x;
    follow(plane, { moved: new Set(['T2']) }, { line: 300, band: [0, 1000] });

    expect(edge.label!.x).toBe(x);
  });

  it('moves a label beyond the line when its run stretches', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f2')!;
    edge.label = new Box(400, 150, 30, 14);
    follow(plane, { moved: new Set(['T1']) });

    expect(edge.label.x).toBe(460);
  });

  it('keeps a label on a line of one point inside the band only', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const edge = plane.edges.get('f1')!;
    edge.points = [];
    edge.label = new Box(500, 150, 30, 14);
    follow(plane, {}, { band: [0, 100] });
    expect(edge.label.x).toBe(500);

    follow(plane, {}, { band: [100, 200] });
    expect(edge.label.x).toBe(560);
  });

  it('shifts along the other axis too', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    follow(plane, { moved: new Set(['T2']) }, { axis: 'y', line: 300, delta: 50 });

    expect(plane.edges.get('f3')!.points.at(-1)!.y).toBe(385);
  });
});

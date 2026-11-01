import { describe, expect, it } from 'vitest';
import { SpaceDecisions } from '../../../../src/drawing/incremental/space/SpaceDecisions.js';
import { SpacePass } from '../../../../src/drawing/incremental/space/SpacePass.js';
import type { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('SpaceDecisions', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  function decisions(plane: Plane, overrides: Partial<ConstructorParameters<typeof SpacePass>[0]> = {}) {
    const before = new Map([...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()]));
    return new SpaceDecisions(new SpacePass({ plane, axis: 'x', line: 390, delta: 60, band: undefined, keep: new Set<string>(), before, held: undefined, push: undefined, scope: undefined, ...overrides })).all();
  }

  it('moves what lies beyond the line and keeps what lies before it', async () => {
    const result = decisions(await planeOf('models/incremental/boundary.bpmn'));

    expect(result.get('C')).toBe('move');
    expect(result.get('A')).toBe('stay');
  });

  it('keeps a boundary event with its host', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');

    expect(decisions(plane, { line: 200 }).get('B')).toBe('move');
    expect(decisions(plane, { line: 300 }).get('B')).toBe('stay');
  });

  it('stays what it must keep', async () => {
    const result = decisions(await planeOf('models/incremental/boundary.bpmn'), { keep: new Set(['C']) });

    expect(result.get('C')).toBe('stay');
    expect(result.get('D')).toBe('move');
  });

  it('resizes a frame across the line and moves its content beyond it', async () => {
    const result = decisions(await planeOf('models/incremental/sub.bpmn'), { line: 500 });

    expect(result.get('SP')).toBe('resize');
    expect(result.get('SE')).toBe('move');
    expect(result.get('ST')).toBe('stay');
  });

  it('moves what a band does not hold only inside the band', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const result = decisions(plane, { line: 900, band: [60, 240] });

    expect(result.get('T2')).toBe('move');
    expect(result.get('SP')).toBe('stay');
  });

  it('leaves a frame alone when shrinking it would cut outside the band', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');

    expect(decisions(plane, { line: 900, band: [100, 300], delta: -40 }).get('L1')).toBe('stay');
    expect(decisions(plane, { line: 900, band: [100, 300] }).get('L1')).toBe('resize');
  });

  it('lets a shape follow a sub-process that lies beyond the line', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');

    expect(decisions(plane, { line: 200 }).get('ST')).toBe('move');
  });

  it('assigns a free shape to the pool and the smallest lane its centre lies in', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const task = plane.shapes.get('T1')!;
    task.laneId = undefined;
    task.poolId = undefined;

    expect(decisions(plane, { line: 128, axis: 'x', delta: 20 }).get('T1')).toBe('move');
    expect(decisions(plane, { line: 200, axis: 'y', delta: 20 }).get('T1')).toBe('stay');
  });

  it('moves a rigid block as a whole by its centre', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const rigid = decisions(plane, { line: 500, held: new Set() });

    expect(rigid.get('SP')).toBe('stay');
    expect(rigid.get('SE')).toBe('stay');
    expect(decisions(plane, { line: 420, held: new Set() }).get('SP')).toBe('move');
    expect(decisions(plane, { line: 420, held: new Set() }).get('ST')).toBe('move');
  });

  it('moves only the listed shapes of a push', async () => {
    const result = decisions(await planeOf('models/incremental/boundary.bpmn'), { push: new Set(['C']) });

    expect(result.get('C')).toBe('move');
    expect(result.get('D')).toBe('stay');
  });

  it('moves a boundary event of a growing frame by its centre', async () => {
    const plane = await planeOf('models/incremental/orders-boundaries.bpmn');
    const line = 1000;

    expect(decisions(plane, { line, band: [370, 550] }).get('Sub_1')).toBe('resize');
    expect(decisions(plane, { line, band: [370, 550] }).get('B_Sub')).toBe('move');
    expect(decisions(plane, { line: 1110, band: [370, 550] }).get('B_Sub')).toBe('stay');
  });

  it('stays outside a scoped frame and grows an ancestor it may grow', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const frame = plane.shapes.get('SP')!;
    const inScope = decisions(plane, { line: 600, band: [280, 500], scope: { frame, ancestors: new Set(['L2', 'Pool']), grow: new Set(['L2']) } });

    expect(inScope.get('Y')).toBe('move');
    expect(inScope.get('T2')).toBe('stay');
    expect(inScope.get('L2')).toBe('resize');
    expect(inScope.get('Pool')).toBe('stay');
    expect(decisions(plane, { line: 90, scope: { frame, ancestors: new Set(['L2']), grow: new Set(['L2']) } }).get('L2')).toBe('stay');
  });
});

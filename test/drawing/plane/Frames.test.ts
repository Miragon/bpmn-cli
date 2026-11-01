import { describe, expect, it } from 'vitest';
import { Frames } from '../../../src/drawing/plane/Frames.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Box } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Frames', () => {
  async function planeOf(path: string) {
    const document = await Fixtures.read(path);
    return new PlaneReader(document.tree.definitions).planes()[0]!;
  }

  it('takes the sub-process, then the lane, then the pool as the frame', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const frames = new Frames(plane);

    expect(frames.of(plane.shapes.get('X')!)?.id).toBe('SP');
    expect(frames.of(plane.shapes.get('T1')!)?.id).toBe('L1');
    expect(frames.of(plane.shapes.get('L1')!)?.id).toBe('Pool');
    expect(frames.of(plane.shapes.get('Pool')!)).toBeUndefined();
  });

  it('finds a frame among the ancestors, and the plane holds everything', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const frames = new Frames(plane);
    const inner = plane.shapes.get('X')!;

    expect(frames.within(inner, plane.shapes.get('Pool'))).toBe(true);
    expect(frames.within(inner, plane.shapes.get('L1'))).toBe(false);
    expect(frames.within(inner, undefined)).toBe(true);
    expect(frames.chain(inner).map(({ id }) => id)).toEqual(['SP', 'L2', 'Pool']);
  });

  it('keeps the header and padding out of the interior', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const lane = plane.shapes.get('L1')!;

    expect(Frames.interior(lane).x).toBe(lane.bounds.x + 45);
    expect(Frames.interior(plane.shapes.get('SP')!).y).toBeGreaterThanOrEqual(plane.shapes.get('SP')!.bounds.y + 25);
  });

  it('knows where a sub-process draws its title and where labels go below it', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const sub = plane.shapes.get('SP')!;
    const title = Frames.title(sub)!;

    expect(title).toBeInstanceOf(Box);
    expect(Frames.labelArea(sub).y).toBe(title.bottom + 2);
    expect(Frames.title(plane.shapes.get('T1')!)).toBeUndefined();
    expect(Frames.labelArea(plane.shapes.get('L1')!).y).toBe(plane.shapes.get('L1')!.bounds.y + 2);
  });

  it('gives no title box to a nameless sub-process', () => {
    expect(Frames.titleBox(new Box(0, 0, 100, 100), undefined)).toBeUndefined();
  });

  it('tells a shape that frames others by its DI', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const isContainer = (id: string): boolean => Frames.isContainerDi(plane.shapes.get(id)!.di!, plane.shapes.get(id)!.el);

    expect(['Pool', 'L1', 'SP', 'T1'].map(isContainer)).toEqual([true, true, true, false]);
  });
});

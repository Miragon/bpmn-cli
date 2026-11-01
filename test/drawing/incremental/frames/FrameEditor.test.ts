import { describe, expect, it } from 'vitest';
import { FrameEditor } from '../../../../src/drawing/incremental/frames/FrameEditor.js';
import { SpaceTool } from '../../../../src/drawing/incremental/space/SpaceTool.js';
import { DShape } from '../../../../src/drawing/plane/DShape.js';
import { Plane } from '../../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../../src/drawing/plane/PlaneReader.js';
import { Semantics } from '../../../../src/drawing/plane/Semantics.js';
import { Fixtures } from '../../../support/Fixtures.js';
import { Box } from '../../../support/ModelValues.js';

describe('FrameEditor', () => {
  async function read(path: string) {
    const document = await Fixtures.read(path);
    const { definitions } = document.tree;
    return { semantics: Semantics.of(definitions), planes: new PlaneReader(definitions).planes() };
  }

  async function planeOf(path: string) {
    return (await read(path)).planes[0]!;
  }

  function editorOf(plane: Plane, touched = new Set<string>()): FrameEditor {
    return new FrameEditor(plane, new SpaceTool(plane), touched);
  }

  function newFrame(plane: Plane, id: string, kind: 'participant' | 'lane'): DShape {
    return new DShape(id, plane.root, new Box(0, 0, 0, 0), kind, true);
  }

  it('wraps a pool around all shapes, labels and lines of the plane', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const pool = newFrame(plane, 'Pool', 'participant');
    editorOf(plane).wrapPool(pool);

    expect(plane.shapes.get('E')!.bounds.isInside(pool.bounds)).toBe(true);
    expect(pool.bounds.x).toBe(152 - 60);
  });

  it('gives a pool around nothing a default box', () => {
    const plane = new Plane('p', 'r', {} as Plane['root']);
    const pool = newFrame(plane, 'Pool', 'participant');
    editorOf(plane).wrapPool(pool);

    expect(pool.bounds).toEqual(new Box(100, 80, 600, 250));
  });

  it('places the first pool under the content', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const pool = newFrame(plane, 'Pool', 'participant');
    plane.shapes.set(pool.id, pool);
    editorOf(plane).placePool(pool, false);

    expect(pool.bounds.y).toBeGreaterThan(plane.shapes.get('E2')!.bounds.bottom);
    expect(pool.bounds.width).toBeGreaterThanOrEqual(600);
    expect(pool.bounds.height).toBe(200);
  });

  it('places a pool on an empty plane at the default spot, black box low', () => {
    const plane = new Plane('p', 'r', {} as Plane['root']);
    const pool = newFrame(plane, 'Pool', 'participant');
    editorOf(plane).placePool(pool, true, { width: 300, height: 90 });
    expect(pool.bounds).toEqual(new Box(100, 80, 300, 90));

    editorOf(plane).placePool(pool, true);
    expect(pool.bounds.height).toBe(60);
  });

  it('places a further pool under the lowest at the usual gap and width', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');
    const pool = newFrame(plane, 'New', 'participant');
    plane.shapes.set(pool.id, pool);
    editorOf(plane).placePool(pool, false);

    expect(pool.bounds.y).toBe(600);
    expect(pool.bounds.x).toBe(100);
    expect(pool.bounds.width).toBe(900);
  });

  it('fills a pool without lanes with its first lane', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const lane = newFrame(plane, 'New', 'lane');
    lane.poolId = 'Pool';

    expect(editorOf(plane).placeLane(lane)).toBe(true);
    expect(lane.bounds).toEqual(new Box(130, 80, 670, 160));
  });

  it('adds a lane under its siblings and grows the pool by its height', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const lane = newFrame(plane, 'New', 'lane');
    lane.poolId = 'Org';
    const touched = new Set<string>();

    expect(editorOf(plane, touched).placeLane(lane)).toBe(true);
    expect(lane.bounds).toEqual(new Box(130, 420, 770, 170));
    expect(plane.shapes.get('Org')!.bounds.bottom).toBe(590);
    expect(touched.has('Org')).toBe(true);
  });

  it('nests a lane in a lane and finds no frame for an orphan', async () => {
    const plane = await planeOf('models/incremental/polish-lanes.bpmn');
    const nested = newFrame(plane, 'Sub', 'lane');
    nested.laneId = 'L1';
    nested.poolId = 'Org';

    expect(editorOf(plane).placeLane(nested)).toBe(true);
    expect(nested.bounds.x).toBe(160);
    expect(editorOf(plane).placeLane(newFrame(plane, 'Lost', 'lane'))).toBe(false);
  });

  it('closes the room of an empty removed lane', async () => {
    const plane = await planeOf('models/incremental/lanesub.bpmn');
    const old = plane.shapes.get('L2')!.bounds.copy();
    for (const id of ['L2', 'SP', 'SS', 'X', 'Y', 'SE']) {
      plane.shapes.delete(id);
    }
    const emptied = new Box(130, 60, 1170, 180);
    plane.shapes.get('L1')!.bounds.y = old.y;
    editorOf(plane).removedLane(emptied, 'Pool', undefined);

    expect(plane.shapes.get('Pool')!.bounds.height).toBeLessThanOrEqual(480);
  });

  it('gives the room of an occupied lane to the lane above or below', async () => {
    const above = await planeOf('models/incremental/polish-lanes.bpmn');
    const touched = new Set<string>();
    above.shapes.delete('L2');
    editorOf(above, touched).removedLane(new Box(130, 250, 770, 170), 'Org', undefined);
    expect(above.shapes.get('L1')!.bounds.bottom).toBe(420);

    const below = await planeOf('models/incremental/polish-lanes.bpmn');
    below.shapes.delete('L1');
    editorOf(below).removedLane(new Box(130, 80, 770, 170), 'Org', undefined);
    expect(below.shapes.get('L2')!.bounds.y).toBe(80);
  });

  it('does nothing for a removed lane without neighbours', async () => {
    const plane = await planeOf('models/incremental/pool.bpmn');
    const before = plane.shapes.get('Pool')!.bounds.copy();
    editorOf(plane).removedLane(new Box(130, 80, 100, 100), 'Pool', 'Gone');

    expect(plane.shapes.get('Pool')!.bounds).toEqual(before);
  });

  it('pulls the pools below up over the room of a removed pool', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');
    for (const id of ['PA', 'S', 'A', 'E', 'Z']) {
      plane.shapes.delete(id);
    }
    plane.edges.delete('F1');
    plane.edges.delete('F2');
    editorOf(plane).removedPool(new Box(100, 60, 500, 260));

    expect(plane.shapes.get('PB')!.bounds.y).toBe(60);
  });

  it('leaves the pools when a shape sits in the room or none lies below', async () => {
    const plane = await planeOf('models/incremental/collabnote.bpmn');
    editorOf(plane).removedPool(new Box(100, 60, 500, 260));
    expect(plane.shapes.get('PB')!.bounds.y).toBe(360);

    editorOf(plane).removedPool(new Box(100, 900, 500, 60));
    expect(plane.shapes.get('PB')!.bounds.y).toBe(360);
  });

  it('reseats boundary events', async () => {
    const plane = await planeOf('models/incremental/boundary.bpmn');
    const host = plane.shapes.get('A')!;
    const old = host.bounds.copy();
    host.bounds = new Box(old.x, old.y, old.width, 120);
    editorOf(plane).reseatBoundaries(host, old);

    expect(plane.shapes.get('B')!.bounds.center.y).toBe(host.bounds.bottom);
  });

  it('collapses a sub-process into a task-sized shape and hands its content to the child plane', async () => {
    const plane = await planeOf('models/incremental/sub.bpmn');
    const sub = plane.shapes.get('SP')!;
    const child = new Plane('child', 'SP', sub.el);
    const touched = new Set<string>();
    editorOf(plane, touched).collapse(sub, child, 60);

    expect(sub.bounds.width).toBe(100);
    expect(sub.container).toBe(false);
    expect(child.shapes.has('ST')).toBe(true);
    expect(child.edges.has('G1')).toBe(true);
    expect(child.shapes.get('ST')!.parentId).toBeUndefined();
    expect(plane.shapes.has('ST')).toBe(false);
    expect(touched.has('SP')).toBe(true);
    expect(plane.shapes.get('T')!.bounds.x).toBeLessThan(700);
  });

  it('collapses inside its pool', async () => {
    const plane = await planeOf('models/incremental/polish-collab.bpmn');
    const sub = plane.shapes.get('ESP')!;
    editorOf(plane).collapse(sub, new Plane('child', 'ESP', sub.el), 60);

    expect(sub.expanded).toBe(false);
  });

  it('expands a collapsed sub-process around the content of its child plane', async () => {
    const { planes, semantics } = await read('models/incremental/sub.bpmn');
    const plane = planes[0]!;
    const sub = plane.shapes.get('SP')!;
    const child = new Plane('child', 'SP', sub.el);
    const editor = editorOf(plane);
    editor.collapse(sub, child, 60);
    editor.expand(sub, child, semantics);

    expect(sub.expanded).toBe(true);
    expect(sub.container).toBe(true);
    expect(plane.shapes.get('ST')!.parentId).toBe('SP');
    expect(plane.shapes.get('ST')!.bounds.isInside(sub.bounds)).toBe(true);
    expect(child.deleted).toBe(true);
    expect(plane.shapes.get('T')!.bounds.x).toBeGreaterThanOrEqual(sub.bounds.right);
  });

  it('expands without a child plane to the size of a new sub-process', async () => {
    const { planes, semantics } = await read('models/incremental/boundary.bpmn');
    const plane = planes[0]!;
    const task = plane.shapes.get('C')!;
    task.kind = 'subProcess';
    editorOf(plane).expand(task, undefined, semantics);

    expect(task.bounds.width).toBe(350);
    expect(task.bounds.height).toBe(200);
  });

  it('gives adopted shapes the pool of the sub-process and keeps an empty child', async () => {
    const { planes, semantics } = await read('models/incremental/polish-collab.bpmn');
    const plane = planes[0]!;
    const sub = plane.shapes.get('ESP')!;
    const child = new Plane('child', 'ESP', sub.el);
    const editor = editorOf(plane);
    editor.collapse(sub, child, 60);
    child.shapes.get('ET')!.poolId = undefined;
    editor.expand(sub, child, semantics);
    expect(plane.shapes.get('ET')!.poolId).toBe('Org');

    const bare = new Plane('bare', 'ESP2', sub.el);
    editor.expand(plane.shapes.get('A')!, bare, semantics);
    expect(bare.deleted).toBe(true);
  });
});

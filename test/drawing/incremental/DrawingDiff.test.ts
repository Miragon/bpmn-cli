import { describe, expect, it } from 'vitest';
import { Drawing } from '../../../src/drawing/incremental/Drawing.js';
import { DrawingDiff } from '../../../src/drawing/incremental/DrawingDiff.js';
import { NodePlacer } from '../../../src/drawing/incremental/placement/NodePlacer.js';
import { PlacementState } from '../../../src/drawing/incremental/placement/PlacementState.js';
import { LayoutRun } from '../../../src/drawing/incremental/run/LayoutRun.js';
import { DrawingSnapshot } from '../../../src/drawing/DrawingSnapshot.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Semantics } from '../../../src/drawing/plane/Semantics.js';
import { Fixtures } from '../../support/Fixtures.js';
import { Box, type BpmnDocument } from '../../support/ModelValues.js';

describe('DrawingDiff', () => {
  function runOver(document: BpmnDocument, snapshot: DrawingSnapshot): { run: LayoutRun; diff: DrawingDiff } {
    const { definitions } = document.tree;
    const semantics = Semantics.of(definitions);
    const planes = new PlaneReader(definitions, semantics).planes();
    const notes: string[] = [];
    const place = new PlacementState({ planes, semantics, oldSource: new Map(), oldTarget: new Map(), collapsed: new Set(), notes, newDrawing: (plane, touched, fresh) => new Drawing(plane, touched, fresh) });
    const run = new LayoutRun(document, snapshot, place, new NodePlacer(place));
    return { run, diff: new DrawingDiff(run, snapshot) };
  }

  async function open(path: string): Promise<{ document: BpmnDocument; snapshot: DrawingSnapshot }> {
    const document = await Fixtures.read(path);
    return { document, snapshot: DrawingSnapshot.of(document) };
  }

  function removeShape(document: BpmnDocument, id: string): void {
    const plane = document.tree.definitions.list('diagrams')[0]!.peek<ReturnType<typeof document.tree.require>>('plane')!;
    const shape = plane.list('planeElement').find((element) => element.peek<{ id: string }>('bpmnElement')?.id === id);
    plane.remove('planeElement', shape!);
    document.tree.invalidate();
  }

  it('notes the room of a removed flow node as a strip', async () => {
    const { document, snapshot } = await open('models/incremental/boundary.bpmn');
    removeShape(document, 'C');
    const { diff } = runOver(document, snapshot);
    const strips = diff.removedAndRelocated(new Set());

    expect(strips).toHaveLength(1);
    expect(strips[0]?.box).toEqual(new Box(400, 80, 100, 80));
  });

  it('skips the room of a shape inside a removed frame', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    removeShape(document, 'SP');
    removeShape(document, 'ST');
    const { diff } = runOver(document, snapshot);

    expect(diff.removedAndRelocated(new Set()).filter(({ parentId }) => parentId === 'SP')).toEqual([]);
  });

  it('closes up lanes and pools that went', async () => {
    const lanes = await open('models/incremental/polish-lanes.bpmn');
    removeShape(lanes.document, 'L2');
    const onLane = runOver(lanes.document, lanes.snapshot);
    onLane.diff.removedAndRelocated(new Set());
    expect(onLane.run.planes[0]!.shapes.get('L1')!.bounds.bottom).toBe(420);

    const pools = await open('models/incremental/polish-collab.bpmn');
    removeShape(pools.document, 'Cust');
    const onPool = runOver(pools.document, pools.snapshot);
    expect(onPool.diff.removedAndRelocated(new Set())).toEqual([]);
  });

  it('lifts a relocated node with its boundary events and queues its lines', async () => {
    const { document, snapshot } = await open('models/incremental/boundary.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const strips = diff.removedAndRelocated(new Set(['A']));

    expect(strips).toHaveLength(1);
    expect(run.place.reuse.get('A')?.boundaries.map(({ id }) => id)).toEqual(['B']);
    expect(run.planes[0]!.shapes.has('B')).toBe(false);
    expect(run.relocated.has('A')).toBe(true);
    expect([...run.reroute].sort()).toEqual(['F1', 'F2', 'F5']);
  });

  it('lifts an expanded sub-process with its content and keeps the lines inside', async () => {
    const { document, snapshot } = await open('models/incremental/lanesub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    diff.removedAndRelocated(new Set(['SP']));

    expect(run.place.reuse.get('SP')?.content?.shapes.map(({ id }) => id)).toContain('X');
    expect(run.reroute.has('F2')).toBe(true);
    expect(run.reroute.has('G2')).toBe(false);
  });

  it('notes a shape whose scope changed like one the changes name', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    snapshot.scopeOf.set('T', 'SP');
    const { run, diff } = runOver(document, snapshot);
    diff.removedAndRelocated(new Set());

    expect(run.relocated.has('T')).toBe(true);
  });

  it('lifts a boundary event that got another host', async () => {
    const { document, snapshot } = await open('models/incremental/boundary.bpmn');
    snapshot.hostOf.set('B', 'C');
    const { run, diff } = runOver(document, snapshot);
    diff.removedAndRelocated(new Set());

    expect(run.place.reuse.get('B')?.boundaries).toEqual([]);
    expect(run.reroute.has('F5')).toBe(true);
    expect(run.planes[0]!.shapes.has('B')).toBe(false);
  });

  it('leaves a boundary event that kept its host', async () => {
    const { document, snapshot } = await open('models/incremental/boundary.bpmn');
    const { run, diff } = runOver(document, snapshot);
    diff.removedAndRelocated(new Set());

    expect(run.relocated.size).toBe(0);
  });

  it('closes a strip and notes what moved', async () => {
    const { document, snapshot } = await open('models/incremental/pool.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const plane = run.planes[0]!;
    plane.shapes.delete('C');
    plane.edges.delete('F2');
    plane.edges.delete('F3');
    plane.shapes.get('E')!.bounds.x = 582;
    diff.closeStrips([{ plane, box: new Box(420, 120, 100, 80), poolId: 'Pool' }], new Set());

    expect(run.place.moved.has('E')).toBe(true);
    expect(plane.shapes.get('E')!.bounds.x).toBeLessThan(582);
  });

  it('keeps a strip when nothing lies beyond it', async () => {
    const { document, snapshot } = await open('models/incremental/pool.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const plane = run.planes[0]!;
    diff.closeStrips([{ plane, box: new Box(1000, 120, 100, 80) }], new Set());

    expect(run.place.moved.size).toBe(0);
  });

  it('closes the right strip first and falls back on the row', async () => {
    const { document, snapshot } = await open('models/incremental/boundary.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const plane = run.planes[0]!;
    plane.shapes.delete('C');
    plane.edges.delete('F2');
    plane.edges.delete('F3');
    diff.closeStrips([{ plane, box: new Box(400, 80, 100, 80) }, { plane, box: new Box(100, 900, 10, 10) }], new Set());

    expect(plane.shapes.get('D')!.bounds.x).toBeLessThan(560);
  });

  it('closes inside a sub-process and keeps what lies outside', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const plane = run.planes[0]!;
    plane.shapes.delete('ST');
    plane.edges.delete('G1');
    plane.edges.delete('G2');
    diff.closeStrips([{ plane, box: new Box(360, 160, 100, 80), parentId: 'SP' }], new Set());

    expect(plane.shapes.get('T')!.bounds.x).toBe(700);
    expect(plane.shapes.get('SE')!.bounds.x).toBeLessThan(522);
  });

  it('expands and collapses what was asked and notes it', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    diff.applyExpansion({ collapse: ['SP'] });

    const sub = run.planes[0]!.shapes.get('SP')!;
    expect(sub.expanded).toBe(false);
    expect(run.planes).toHaveLength(2);
    expect(run.active.has('SP')).toBe(true);
    expect(run.reroute.has('F1')).toBe(true);
    expect(run.notes).toEqual(['SP drawn collapsed']);

    diff.applyExpansion({ expand: ['SP'] });
    expect(sub.expanded).toBe(true);
    expect(run.notes.at(-1)).toBe('SP drawn expanded');
  });

  it('leaves a sub-process already as asked', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    diff.applyExpansion({ expand: ['SP'] });
    diff.applyExpansion({});

    expect(run.notes).toEqual([]);
  });

  it('reuses the plane a collapsed sub-process already has', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const sub = run.planes[0]!.shapes.get('SP')!;
    diff.applyExpansion({ collapse: ['SP'] });
    diff.applyExpansion({ expand: ['SP'] });
    diff.applyExpansion({ collapse: ['SP'] });

    expect(run.planes.filter((plane) => plane.rootId === 'SP')).toHaveLength(1);
    expect(sub.expanded).toBe(false);
  });

  it('shrinks a shape that was an expanded sub-process until it was retyped', async () => {
    const { document, snapshot } = await open('models/incremental/sub.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const shape = run.planes[0]!.shapes.get('SP')!;
    shape.kind = 'task';
    diff.applyExpansion({});

    expect(shape.bounds.width).toBe(100);
    expect(shape.container).toBe(false);
    expect(run.active.has('SP')).toBe(true);
    expect(run.reroute.has('F1')).toBe(true);
  });

  it('shrinks inside the band of its pool', async () => {
    const { document, snapshot } = await open('models/incremental/polish-collab.bpmn');
    const { run, diff } = runOver(document, snapshot);
    const shape = run.planes[0]!.shapes.get('ESP')!;
    shape.kind = 'task';
    diff.applyExpansion({});

    expect(shape.bounds.width).toBe(100);
  });

  it('moves a node whose lane changed', async () => {
    const { document, snapshot } = await open('models/incremental/polish-lanes.bpmn');
    snapshot.laneOf.set('T1', 'L2');
    const { run, diff } = runOver(document, snapshot);
    const task = run.planes[0]!.shapes.get('T1')!;
    const lane = run.planes[0]!.shapes.get('L1')!;
    task.bounds.y = 300;
    diff.laneChanges();

    expect(run.active.has('T1')).toBe(true);
    expect(task.bounds.isInside(lane.bounds)).toBe(true);
  });

  it('leaves nodes in their lane, boundary events and what this run placed', async () => {
    const { document, snapshot } = await open('models/incremental/polish-lanes.bpmn');
    snapshot.laneOf.set('J', 'L2');
    const { run, diff } = runOver(document, snapshot);
    run.place.placed.add('J');
    diff.laneChanges();

    expect(run.active.size).toBe(0);
  });
});

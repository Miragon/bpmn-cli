import { describe, expect, it } from 'vitest';
import { DrawingSnapshot } from '../../src/drawing/DrawingSnapshot.js';
import { type BpmnElement, ChangeEntries, Point } from '../support/ModelValues.js';
import { Fixtures } from '../support/Fixtures.js';

describe('DrawingSnapshot', () => {
  function planeElementOf(document: Awaited<ReturnType<typeof Fixtures.read>>, id: string, planeIndex = 0): BpmnElement {
    return document.diagram.planes()[planeIndex]!.list('planeElement').find((element) => element.peek<BpmnElement>('bpmnElement')?.id === id)!;
  }

  it('is empty on a plane without flow node shapes and on a file without diagram', async () => {
    expect(DrawingSnapshot.of(await Fixtures.read('drawing/empty-diagram.bpmn')).isEmpty()).toBe(true);
    expect(DrawingSnapshot.of(await Fixtures.read('drawing/idless.bpmn')).isEmpty()).toBe(true);
    expect(DrawingSnapshot.of(await Fixtures.read('models/incremental/boundary.bpmn')).isEmpty()).toBe(false);
  });

  it('holds what each DI element showed and the semantic facts to compare with', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    const snapshot = DrawingSnapshot.of(document);

    expect(snapshot.flowNodeShapes).toBe(7);
    expect(snapshot.rootId).toBe('P1');
    expect(snapshot.byPlaneElement.get(planeElementOf(document, 'A'))).toMatchObject({ id: 'A', kind: 'task', type: 'bpmn:Task' });
    expect(snapshot.byPlaneElement.get(planeElementOf(document, 'F5'))).toMatchObject({ id: 'F5', kind: 'sequenceFlow', sourceId: 'B', targetId: 'E2' });
    expect(snapshot.hostOf.get('B')).toBe('A');
    expect(snapshot.names.get('A')).toBe('Task A');
    expect(snapshot.flowEnds.get('F1')).toEqual({ sourceId: 'S', targetId: 'A' });
    expect(snapshot.scopeOf.get('A')).toBe('P1');
  });

  it('copies coordinates, so a later move does not change it', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    const shape = planeElementOf(document, 'A');
    const before = snapshot.byPlaneElement.get(shape)!.bounds!.x;

    shape.peek<BpmnElement>('bounds')!.set('x', 9999);

    expect(snapshot.byPlaneElement.get(shape)!.bounds!.x).toBe(before);
  });

  it('tells what a document drew differently, and that it drew the same again', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const snapshot = DrawingSnapshot.of(document);

    expect(snapshot.redrawnIn(document)).toEqual({ moved: [], rerouted: [] });

    const [shape] = document.diagram.planes()[0]!.list('planeElement').filter((element) => element.is('bpmndi:BPMNShape'));
    shape!.get<BpmnElement>('bounds').set('x', 7);

    expect(snapshot.redrawnIn(document).moved).toEqual([shape!.get<BpmnElement>('bpmnElement').id]);
  });

  it('takes an id before the operations to the id now', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const snapshot = DrawingSnapshot.of(document);

    Fixtures.element(document, 'A').set('id', 'renamed');

    expect(snapshot.currentId('A')).toBe('renamed');
    expect(snapshot.currentId('unknown')).toBe('unknown');
    expect(snapshot.currentId(undefined)).toBeUndefined();
  });

  it('sees a changed end, a renamed end as the same', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    const edge = planeElementOf(document, 'F2');
    const flow = Fixtures.element(document, 'F2');
    expect(snapshot.changedEnds(edge)).toEqual([]);

    flow.set('targetRef', Fixtures.element(document, 'D'));
    flow.set('sourceRef', Fixtures.element(document, 'S'));

    expect(snapshot.changedEnds(edge)).toEqual([{ end: 'source', id: 'S' }, { end: 'target', id: 'D' }]);
    expect(snapshot.changedEnds(planeElementOf(document, 'A'))).toEqual([]);
  });

  it('follows a retyped end to its successor', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    const old = Fixtures.element(document, 'C');
    const retyped = document.tree.build('bpmn:UserTask', { id: 'C' });
    ChangeEntries.recordReplacement(old, retyped);
    Fixtures.element(document, 'F2').set('targetRef', retyped);

    expect(snapshot.changedEnds(planeElementOf(document, 'F2'))).toEqual([]);
  });

  it('prunes a further view that still shows the old end, not the first diagram', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    Fixtures.element(document, 'F2').set('targetRef', Fixtures.element(document, 'D'));

    const pruned = snapshot.pruneReEnded(document.tree.definitions);

    expect(pruned).toEqual(['F2']);
    expect(planeElementOf(document, 'F2')).toBeDefined();
    expect(planeElementOf(document, 'F2', 1)).toBeUndefined();
  });

  it('keeps a further view whose line already reaches the new end', async () => {
    const document = await Fixtures.read('models/incremental/twoviews.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    Fixtures.element(document, 'F2').set('targetRef', Fixtures.element(document, 'D'));
    const target = planeElementOf(document, 'D', 1).peek<BpmnElement>('bounds')!;
    const waypoints = planeElementOf(document, 'F2', 1).list('waypoint');
    const end = new Point(target.peek<number>('x')!, target.peek<number>('y')!);
    waypoints.at(-1)!.set('x', end.x);
    waypoints.at(-1)!.set('y', end.y);

    expect(snapshot.pruneReEnded(document.tree.definitions)).toEqual([]);
  });

  it('resolves the stickies it holds after a rename, and drops those of a removed node', async () => {
    const document = await Fixtures.read('drawing/stickies.bpmn');
    const snapshot = DrawingSnapshot.of(document);
    const renamed = Fixtures.element(document, 'task');

    renamed.set('id', 'renamed_task');
    document.tree.invalidate();

    expect(snapshot.resolvedAnchors(document).map(({ nodeId }) => nodeId)).toEqual(['renamed_task', 'next']);
    Fixtures.element(document, 'process').remove('flowElements', Fixtures.element(document, 'next'));
    document.tree.invalidate();
    expect(snapshot.resolvedAnchors(document).map(({ nodeId }) => nodeId)).toEqual(['renamed_task']);
  });

  it('remembers the name of a group', async () => {
    const document = await Fixtures.read('drawing/group-around-nothing.bpmn');

    expect(DrawingSnapshot.of(document).groupNames.get(Fixtures.element(document, 'around_nothing'))).toBe('');
  });
});

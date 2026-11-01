import { describe, expect, it } from 'vitest';
import { DEdge } from '../../../src/drawing/plane/DEdge.js';
import { DShape } from '../../../src/drawing/plane/DShape.js';
import { Plane } from '../../../src/drawing/plane/Plane.js';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { PlaneWriter } from '../../../src/drawing/plane/PlaneWriter.js';
import { Box, DocumentWriter, Point, type BpmnDocument, type BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('PlaneWriter', () => {
  async function drawn(path: string): Promise<{ document: BpmnDocument; planes: Plane[]; writer: PlaneWriter }> {
    const document = await Fixtures.read(path);
    return { document, planes: new PlaneReader(document.tree.definitions).planes(), writer: new PlaneWriter(document.tree) };
  }

  it('writes nothing over a drawing nothing moved', async () => {
    const { document, planes, writer } = await drawn('models/incremental/boundary.bpmn');
    const before = await new DocumentWriter().plain(document);

    writer.write(planes);

    expect(await new DocumentWriter().plain(document)).toBe(before);
  });

  it('rounds what moved to whole pixels and keeps the DI objects', async () => {
    const { planes, writer } = await drawn('models/incremental/boundary.bpmn');
    const shape = planes[0]!.shapes.get('C')!;
    const { di } = shape;
    shape.bounds = new Box(1000.4, 2000.6, 100, 80);

    writer.write(planes);

    expect(shape.di).toBe(di);
    expect(di!.peek<BpmnElement>('bounds')!.peek('x')).toBe(1000);
    expect(di!.peek<BpmnElement>('bounds')!.peek('y')).toBe(2001);
  });

  it('keeps two waypoints when rounding would merge them', async () => {
    const { planes, writer } = await drawn('models/incremental/boundary.bpmn');
    const edge = planes[0]!.edges.get('F1')!;
    edge.points = [new Point(500.2, 500), new Point(500.4, 500)];

    writer.write(planes);

    expect(edge.di!.list('waypoint')).toHaveLength(2);
  });

  it('creates DI for a new shape and a new edge in the id style of the file', async () => {
    const { document, planes, writer } = await drawn('models/incremental/boundary.bpmn');
    const plane = planes[0]!;
    const fresh = document.tree.create('bpmn:ExclusiveGateway', { id: 'fresh' });
    const shape = new DShape('fresh', fresh, new Box(0, 0, 50, 50), 'gateway', false);
    shape.label = new Box(0, 60, 20, 14);
    plane.shapes.set('fresh', shape);
    const flow = document.tree.create('bpmn:SequenceFlow', { id: 'fresh_flow' });
    const edge = new DEdge('fresh_flow', flow, 'sequenceFlow', [new Point(0, 0), new Point(10, 0)]);
    edge.label = new Box(1, 2, 3, 4);
    plane.edges.set('fresh_flow', edge);

    writer.write(planes);

    expect(shape.di?.peek('isMarkerVisible')).toBe(true);
    expect(shape.di?.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds')?.peek('y')).toBe(60);
    expect(edge.di?.list('waypoint')).toHaveLength(2);
    expect(plane.di!.list('planeElement')).toContain(edge.di);
  });

  it('marks a new pool horizontal and a new sub-process with its expansion', async () => {
    const { document, planes, writer } = await drawn('models/incremental/boundary.bpmn');
    const pool = new DShape('new_pool', document.tree.create('bpmn:Participant', { id: 'new_pool' }), new Box(0, 0, 500, 200), 'participant', true);
    const sub = new DShape('new_sub', document.tree.create('bpmn:SubProcess', { id: 'new_sub' }), new Box(0, 0, 350, 200), 'subProcess', true);
    sub.expanded = true;
    planes[0]!.shapes.set('new_pool', pool);
    planes[0]!.shapes.set('new_sub', sub);

    writer.write(planes);

    expect(pool.di?.peek('isHorizontal')).toBe(true);
    expect(sub.di?.peek('isExpanded')).toBe(true);
  });

  it('follows a collapse of an existing sub-process', async () => {
    const { planes, writer } = await drawn('models/incremental/sub.bpmn');
    const sub = planes[0]!.shapes.get('SP')!;
    sub.expanded = false;

    writer.write(planes);

    expect(sub.di!.peek('isExpanded')).toBe(false);
  });

  it('creates plane and diagram for a plane without DI', async () => {
    const { document, writer } = await drawn('models/incremental/sub.bpmn');
    const sub = Fixtures.element(document, 'SP');
    const plane = new Plane('new', 'SP', sub);

    writer.write([plane]);

    expect(document.tree.definitions.list('diagrams')).toHaveLength(2);
    expect(plane.di?.peek('bpmnElement')).toBe(sub);
    expect(plane.id).not.toBe('new');
  });

  it('points a plane at its root again', async () => {
    const { document, planes, writer } = await drawn('models/incremental/noroot.bpmn');
    const root = Fixtures.element(document, 'P1');
    planes[0]!.root = root;

    writer.write(planes);

    expect(planes[0]!.di!.peek('bpmnElement')).toBe(root);
  });

  it('deletes a dropped element and a deleted plane', async () => {
    const { document, planes, writer } = await drawn('models/incremental/twoviews.bpmn');
    const [main, view] = planes;
    const dropped = main!.shapes.get('A')!;
    main!.shapes.delete('A');
    main!.dropped.push(dropped.di!);
    view!.deleted = true;

    writer.write(planes);

    expect(main!.dropped).toEqual([]);
    expect(main!.di!.list('planeElement')).not.toContain(dropped.di);
    expect(document.tree.definitions.list('diagrams')).toHaveLength(1);
  });

  it('moves a shape into the plane that now shows it', async () => {
    const { planes, writer } = await drawn('models/incremental/twoviews.bpmn');
    const [main, view] = planes;
    const shape = main!.shapes.get('A')!;
    main!.shapes.delete('A');
    view!.shapes.set('other', shape);

    writer.write(planes);

    expect(view!.di!.list('planeElement')).toContain(shape.di);
    expect(main!.di!.list('planeElement')).not.toContain(shape.di);
  });
});

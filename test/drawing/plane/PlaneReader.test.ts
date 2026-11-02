import { describe, expect, it } from 'vitest';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('PlaneReader', () => {
  async function planesOf(path: string) {
    const document = await Fixtures.read(path);
    return { document, planes: new PlaneReader(document.tree.definitions).planes() };
  }

  it('reads shapes, edges and labels of a plane', async () => {
    const { planes } = await planesOf('models/incremental/boundary.bpmn');
    const [plane] = planes;

    expect(plane!.rootId).toBe('P1');
    expect(plane!.shapes.get('B')?.kind).toBe('boundary');
    expect(plane!.shapes.get('B')?.hostId).toBe('A');
    expect(plane!.edges.get('F5')).toMatchObject({ kind: 'sequenceFlow', sourceId: 'B', targetId: 'E2' });
    expect(plane!.edges.get('F5')!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('takes membership from the semantics: lane, pool, parent', async () => {
    const { planes } = await planesOf('models/incremental/lanesub.bpmn');
    const { shapes } = planes[0]!;

    expect(shapes.get('X')).toMatchObject({ parentId: 'SP', poolId: 'Pool' });
    expect(shapes.get('T1')).toMatchObject({ laneId: 'L1', poolId: 'Pool' });
    expect(shapes.get('SP')).toMatchObject({ kind: 'subProcess', container: true, expanded: true });
    expect(shapes.get('L1')).toMatchObject({ kind: 'lane', container: true });
  });

  it('keeps a shape without valid bounds apart', async () => {
    const { planes } = await planesOf('models/incremental/nobounds.bpmn');

    expect([...planes[0]!.unbounded!.keys()]).toHaveLength(1);
  });

  it('shows the first process on a plane without bpmnElement', async () => {
    const { planes } = await planesOf('models/incremental/noroot.bpmn');

    expect(planes[0]!.rootId).toBe('P1');
  });

  it('reads the ends of a data association through its activity', async () => {
    const document = await Fixtures.read('scoring/data-association.bpmn');
    const associations = [...document.tree.walk()].filter((element) => element.is('bpmn:DataAssociation'));

    expect(associations.map((association) => Object.values(PlaneReader.edgeEnds(association)).every(Boolean))).toEqual(associations.map(() => true));
    expect(associations.map(PlaneReader.edgeKind)).toEqual(associations.map(() => 'dataAssociation'));
  });

  it('calls what it cannot place other', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(PlaneReader.shapeKind(document.tree.definitions)).toBe('other');
    expect(PlaneReader.edgeKind(document.tree.definitions)).toBe('other');
  });

  it('skips a diagram without a plane', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const diagram = document.tree.build('bpmndi:BPMNDiagram', { id: 'empty_diagram' });

    expect(new PlaneReader(document.tree.definitions).plane(diagram)).toBeUndefined();
  });
});

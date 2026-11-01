import { describe, expect, it } from 'vitest';
import { PlaneReader } from '../../../src/drawing/plane/PlaneReader.js';
import { Semantics } from '../../../src/drawing/plane/Semantics.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Semantics', () => {
  async function read(path: string) {
    const document = await Fixtures.read(path);
    const semantics = Semantics.of(document.tree.definitions);
    return { document, semantics, planes: new PlaneReader(document.tree.definitions, semantics).planes() };
  }

  it('indexes scopes, lanes and pools', async () => {
    const { semantics } = await read('models/incremental/lanesub.bpmn');

    expect(semantics.scopeOf.get('X')?.id).toBe('SP');
    expect(semantics.laneOf.get('T1')).toBe('L1');
    expect(semantics.laneProcess.get('L2')).toBe('P1');
    expect(semantics.poolOfProcess.get('P1')).toBe('Pool');
    expect(semantics.collaboration?.id).toBe('C1');
  });

  it('finds the process and pool of an element, through a sub-process and a lane', async () => {
    const { semantics } = await read('models/incremental/lanesub.bpmn');

    expect(semantics.processOf('X')?.id).toBe('P1');
    expect(semantics.poolOf('X')).toBe('Pool');
    expect(semantics.poolOf('L1')).toBe('Pool');
    expect(semantics.poolOf('Pool')).toBeUndefined();
    expect(semantics.poolOf('missing')).toBeUndefined();
  });

  it('finds the plane an element lives on', async () => {
    const { semantics, planes } = await read('models/incremental/lanesub.bpmn');

    expect(semantics.homePlane(planes, 'Pool')?.rootId).toBe('C1');
    expect(semantics.homePlane(planes, 'L1')?.rootId).toBe('C1');
    expect(semantics.homePlane(planes, 'T1')?.rootId).toBe('C1');
    expect(semantics.homePlane(planes, 'X')?.rootId).toBe('C1');
    expect(semantics.homePlane(planes, 'missing')).toBeUndefined();
  });

  it('finds the own plane of a collapsed sub-process and of a process without pool', async () => {
    const { semantics, planes } = await read('layout/subproc__s03-collapsed.bpmn');
    const collapsed = [...semantics.byId.values()].find((element) => element.is('bpmn:SubProcess') && element.list('flowElements').length)!;
    const inner = collapsed.list('flowElements')[0]!;

    expect(semantics.homePlane(planes, inner.id)?.rootId).toBe(collapsed.id);
    expect(semantics.homePlane(planes, collapsed.id)).toBeDefined();
  });

  it('takes a data association to the plane of its activity and a note of a collaboration to its plane', async () => {
    const data = await read('scoring/data-association.bpmn');
    const association = [...data.semantics.byId.values()].find((element) => element.is('bpmn:DataAssociation'));
    const notes = await read('models/incremental/collabnote.bpmn');
    const collaboration = notes.semantics.collaboration!;

    expect(association && data.semantics.homePlane(data.planes, association.id)).toBe(association && data.planes[0]);
    expect(collaboration.list('artifacts').every((artifact) => notes.semantics.homePlane(notes.planes, artifact.id)?.rootId === collaboration.id)).toBe(true);
    expect(notes.semantics.homePlane(notes.planes, 'nothing')).toBeUndefined();
  });

  it('follows flows both ways', async () => {
    const { semantics } = await read('models/incremental/boundary.bpmn');

    expect(semantics.predecessors('C')).toEqual(['A']);
    expect(semantics.successors('C')).toEqual(['D']);
  });

  it('takes a line of a note as an annotation line, a data association not', async () => {
    const notes = await read('layout/artifacts__01-annotations-basic.bpmn');
    const lines = [...notes.semantics.byId.values()].filter((element) => element.is('bpmn:Association'));
    const data = await read('scoring/data-association.bpmn');
    const associations = [...data.semantics.byId.values()].filter((element) => element.is('bpmn:DataAssociation'));

    expect(lines.every(Semantics.isAnnotationLine)).toBe(true);
    expect(associations.some(Semantics.isAnnotationLine)).toBe(false);
  });
});

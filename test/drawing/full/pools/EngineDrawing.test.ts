import { describe, expect, it } from 'vitest';
import { EngineDrawing } from '../../../../src/drawing/full/pools/EngineDrawing.js';
import { LayoutRequests } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('EngineDrawing', () => {
  it('copies a sub-process as a block, with its content and its collapsed planes', async () => {
    const document = await Fixtures.read('layout/subproc__s04-mixed.bpmn');
    const sub = [...document.tree.all().values()].find((element) => element.is('bpmn:SubProcess'))!;

    const block = (await EngineDrawing.of(document, new LayoutRequests())).block(sub.id, false);

    expect(block?.shapes.length).toBeGreaterThan(0);
    expect(block?.box.width).toBeGreaterThan(0);
  });

  it('copies a pool as a block without its message flows', async () => {
    const document = await Fixtures.read('layout/gallery__05-collab.bpmn');
    const pool = document.tree.collaboration()!.list('participants')[0]!;

    const block = (await EngineDrawing.of(document, new LayoutRequests())).block(pool.id, true);

    expect(block?.edges.every((edge) => edge.kind !== 'messageFlow')).toBe(true);
  });

  it('leaves the document it copies untouched and answers nothing for an unknown id', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const diagrams = document.tree.definitions.list('diagrams');

    const engine = await EngineDrawing.of(document, new LayoutRequests());

    expect(document.tree.definitions.list('diagrams')).toEqual(diagrams);
    expect(engine.block('Nothing', false)).toBeUndefined();
  });

  it('takes the planes of collapsed sub-processes into the block around them', async () => {
    const document = await Fixtures.read('layout/subproc__s02-nested3.bpmn');
    const [outer, inner] = [...document.tree.all().values()].filter((element) => element.is('bpmn:SubProcess'));
    const requests = new LayoutRequests();
    requests.expand(inner!.id, false);

    expect((await EngineDrawing.of(document, requests)).block(outer!.id, false)?.planes.map((plane) => plane.rootId)).toEqual([inner!.id]);
  });

  it('takes the planes of collapsed sub-processes into the block of their pool', async () => {
    const document = await Fixtures.read('layout/subproc__s08-collab3.bpmn');
    const sub = [...document.tree.all().values()].find((element) => element.is('bpmn:SubProcess'));
    const pool = document.tree.collaboration()!.list('participants').find((participant) => participant.peek('processRef') === sub?.parent);
    const requests = new LayoutRequests();
    requests.expand(sub?.id ?? '', false);

    expect((await EngineDrawing.of(document, requests)).block(pool?.id ?? '', true)?.planes).toHaveLength(sub ? 1 : 0);
  });
});

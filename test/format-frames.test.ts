/**
 * Format ops with selector sets never take a shape out of its sub-process
 * (verifier round of step 3: `align --kind endEvent --axis column` moved the
 * end events of a sub-process to a column outside it, the sub-process grew
 * towards it, was pushed aside and left them behind: hard outsideSub). A
 * sub-process grows towards a reference inside it, never towards one outside
 * it: a member a selector picked is left out with a note, an explicit id is
 * refused (E_LEAVES_CONTAINER), and whatever making room does, no shape
 * leaves a frame that held it. Synthetic models only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { readPlanes, semantics } from '../src/diagram/plane.js';
import { inside } from '../src/diagram/geom.js';
import { isCliError } from '../src/errors.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, type MutationResult } from '../src/pipeline.js';

/** S -> Sub (S1 -> T1 -> E1) -> G -> B -> E, G -> C -> E2: the sub-process's end event E1 lies left of the outer end events. */
const MODEL: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'subProcess', id: 'Sub', name: 'Prepare', after: 'S' },
  { op: 'add', kind: 'startEvent', id: 'S1', name: 'Begin', in: 'Sub' },
  { op: 'add', kind: 'task', id: 'T1', name: 'Pack', after: 'S1' },
  { op: 'add', kind: 'endEvent', id: 'E1', name: 'Packed', after: 'T1' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'Ok?', after: 'Sub' },
  { op: 'add', kind: 'task', id: 'B', name: 'Ship', after: 'G', flowName: 'yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Shipped', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Return', after: 'G', flowName: 'no' },
  { op: 'add', kind: 'task', id: 'C2', name: 'Refund', after: 'C' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Returned', after: 'C2' },
];

async function model(): Promise<string> {
  return (await mutateDoc(Doc.create({ processId: 'P' }), MODEL, { dryRun: true })).xml;
}

async function run(xml: string, ops: Op[]): Promise<{ r: MutationResult; doc: Doc }> {
  const r = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, layout: 'incremental' });
  return { r, doc: await Doc.fromXml(r.xml) };
}

async function failure(xml: string, ops: Op[]): Promise<{ code: string; message: string; element?: string; related?: string[]; hint?: string }> {
  try {
    await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, layout: 'incremental' });
  } catch (err) {
    if (isCliError(err)) return { code: err.code, message: err.message, ...err.details };
    throw err;
  }
  throw new Error('expected the mutation to fail');
}

/** Every shape inside its expanded sub-process. */
function outsideSub(doc: Doc): string[] {
  const sem = semantics(doc.definitions);
  const out: string[] = [];
  for (const plane of readPlanes(doc.definitions, sem)) {
    for (const s of plane.shapes.values()) {
      const parent = s.parentId ? plane.shapes.get(s.parentId) : undefined;
      if (parent?.container && !inside(s.bounds, parent.bounds)) out.push(`${s.id} outside ${parent.id}`);
    }
  }
  return out;
}

const centreX = (doc: Doc, id: string): number => {
  const s = readPlanes(doc.definitions, semantics(doc.definitions))
    .map((p) => p.shapes.get(id))
    .find((x) => !!x)!;
  return s.bounds.x + s.bounds.width / 2;
};

describe('format ops with selector sets keep shapes in their sub-process', () => {
  it('align --kind leaves out a member whose sub-process the line lies outside, and says so', async () => {
    const xml = await model();
    const { r, doc } = await run(xml, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    const entry = r.layout.format?.[0];
    expect(entry?.notes).toContain('left out E1 (sub-process Sub): on the column of E2 it would leave its frame');
    expect(entry?.moved).not.toContain('E1');
    expect(entry?.moved).not.toContain('Sub');
    expect(centreX(doc, 'E')).toBe(centreX(doc, 'E2'));
    expect(outsideSub(doc)).toEqual([]);
    expect((r.layout.metrics?.added ?? []).filter((p) => p.kind.startsWith('outside'))).toEqual([]);
  });

  it('align with explicit ids and a reference outside the sub-process is refused (E_LEAVES_CONTAINER), naming the sub-process', async () => {
    const xml = await model();
    const e = await failure(xml, [{ op: 'align', ids: ['E1', 'E'], axis: 'column', to: 'E2' }]);
    expect(e).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'E1', related: ['Sub'] });
    expect(e.message).toBe('Placing E1 in the column of E2 would move it out of its sub-process Sub');
    expect(e.hint).toMatch(/^The reference lies outside sub-process Sub, which would have to grow out to it/);
  });

  it('place --kind moves the selected set as one group: a member that would leave its sub-process refuses the op', async () => {
    const xml = await model();
    const e = await failure(xml, [{ op: 'place', kind: 'endEvent', below: 'C2' }]);
    expect(e).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'E1', related: ['Sub'] });
  });

  it('a reference inside the sub-process still lets it grow; the members of one frame align', async () => {
    const xml = await model();
    // the end event inside, on the row of the task inside: fine
    const { r, doc } = await run(xml, [{ op: 'align', ids: ['T1', 'E1'], axis: 'row' }]);
    expect(r.layout.format?.[0]?.notes ?? []).not.toContainEqual(expect.stringMatching(/left out/));
    expect(outsideSub(doc)).toEqual([]);
    // place after a node inside it: the sub-process grows to the right
    const grown = await run(xml, [{ op: 'place', ids: ['T1'], after: 'E1' }]);
    expect(grown.r.layout.format?.[0]?.moved).toContain('Sub');
    expect(outsideSub(grown.doc)).toEqual([]);
  });

  it('the scenarios the fuzzer and the verifier hit: no outsideSub, the inner members left out or the op refused', async () => {
    const scenario = (name: string): string => readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', name), 'utf8');
    // align --kind serviceTask --axis column: the service task of the assessment sub-process stayed behind its moved frame
    const anno = await run(scenario('agent__anno2.bpmn'), [{ op: 'align', kind: 'serviceTask', axis: 'column' }]);
    expect(anno.r.layout.format?.[0]?.notes).toContainEqual(expect.stringMatching(/^left out Activity_CheckCoverage \(sub-process Activity_AssessClaim\)/));
    expect(outsideSub(anno.doc)).toEqual([]);
    expect((anno.r.layout.metrics?.added ?? []).filter((p) => p.kind.startsWith('outside'))).toEqual([]);
    // every end event onto the column of an outer one, named explicitly
    const claim = scenario('agent__claim.noanno.bpmn');
    const e = await failure(claim, [{ op: 'align', ids: ['Event_AssessmentDone', 'Event_NotCovered', 'Event_ClaimRejected', 'Event_ManagerInformed', 'Event_ClaimSettled', 'Event_2', 'Event_Reminded'], axis: 'column', to: 'Event_Reminded' }]);
    expect(e).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'Event_AssessmentDone', related: ['Activity_AssessClaim'] });
    const kind = await run(claim, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    expect(outsideSub(kind.doc)).toEqual([]);
    expect((kind.r.layout.metrics?.added ?? []).filter((p) => p.kind.startsWith('outside'))).toEqual([]);
  });
});

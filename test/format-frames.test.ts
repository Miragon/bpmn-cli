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
import { Doc } from '../src/domain/document/Doc.js';
import { inside } from '../src/domain/diagram/utils/geom.js';
import { DiagramReader } from '../src/domain/diagram/di/DiagramReader.js';
import { Semantics } from '../src/domain/diagram/di/Semantics.js';
import { isCliError } from '../src/domain/document/utils/errors.js';
import type { EditCommand } from '../src/domain/commands/types.js';
import { mutateDoc } from '../src/index.js';
import { type MutationResult } from '../src/domain/batch/types.js';

/** S -> Sub (S1 -> T1 -> E1) -> G -> B -> E, G -> C -> E2: the sub-process's end event E1 lies left of the outer end events. */
const MODEL: EditCommand[] = [
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

async function run(xml: string, ops: EditCommand[]): Promise<{ result: MutationResult; doc: Doc }> {
  const outcome = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, layout: 'incremental' });
  return { result: outcome, doc: await Doc.fromXml(outcome.xml) };
}

async function failure(xml: string, ops: EditCommand[]): Promise<{ code: string; message: string; element?: string; related?: string[]; hint?: string }> {
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
  const sem = Semantics.of(doc.definitions);
  const out: string[] = [];
  for (const plane of new DiagramReader(doc.definitions, sem).planes()) {
    for (const shape of plane.shapes.values()) {
      const parent = shape.parentId ? plane.shapes.get(shape.parentId) : undefined;
      if (parent?.container && !inside(shape.bounds, parent.bounds)) out.push(`${shape.id} outside ${parent.id}`);
    }
  }
  return out;
}

const centreX = (doc: Doc, id: string): number => {
  const shape = new DiagramReader(doc.definitions, Semantics.of(doc.definitions)).planes()
    .map((plane) => plane.shapes.get(id))
    .find((found) => !!found)!;
  return shape.bounds.x + shape.bounds.width / 2;
};

describe('format ops with selector sets keep shapes in their sub-process', () => {
  it('align --kind leaves out a member whose sub-process the line lies outside, and says so', async () => {
    const xml = await model();
    const { result: outcome, doc } = await run(xml, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    const entry = outcome.layout.format?.[0];
    expect(entry?.notes).toContain('left out E1 (sub-process Sub): on the column of E2 it would leave its frame');
    expect(entry?.moved).not.toContain('E1');
    expect(entry?.moved).not.toContain('Sub');
    expect(centreX(doc, 'E')).toBe(centreX(doc, 'E2'));
    expect(outsideSub(doc)).toEqual([]);
    expect((outcome.layout.metrics?.added ?? []).filter((problem) => problem.kind.startsWith('outside'))).toEqual([]);
  });

  it('align with explicit ids and a reference outside the sub-process is refused (E_LEAVES_CONTAINER), naming the sub-process', async () => {
    const xml = await model();
    const cliError = await failure(xml, [{ op: 'align', ids: ['E1', 'E'], axis: 'column', to: 'E2' }]);
    expect(cliError).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'E1', related: ['Sub'] });
    expect(cliError.message).toBe('Placing E1 in the column of E2 would move it out of its sub-process Sub');
    expect(cliError.hint).toMatch(/^The reference lies outside sub-process Sub, which would have to grow out to it/);
  });

  it('place --kind moves the selected set as one group: a member that would leave its sub-process refuses the op', async () => {
    const xml = await model();
    const cliError = await failure(xml, [{ op: 'place', kind: 'endEvent', below: 'C2' }]);
    expect(cliError).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'E1', related: ['Sub'] });
  });

  it('a reference inside the sub-process still lets it grow; the members of one frame align', async () => {
    const xml = await model();
    // the end event inside, on the row of the task inside: fine
    const { result: outcome, doc } = await run(xml, [{ op: 'align', ids: ['T1', 'E1'], axis: 'row' }]);
    expect(outcome.layout.format?.[0]?.notes ?? []).not.toContainEqual(expect.stringMatching(/left out/));
    expect(outsideSub(doc)).toEqual([]);
    // place after a node inside it: the sub-process grows to the right
    const grown = await run(xml, [{ op: 'place', ids: ['T1'], after: 'E1' }]);
    expect(grown.result.layout.format?.[0]?.moved).toContain('Sub');
    expect(outsideSub(grown.doc)).toEqual([]);
  });

  it('the scenarios the fuzzer and the verifier hit: no outsideSub, the inner members left out or the op refused', async () => {
    const scenario = (name: string): string => readFileSync(join(import.meta.dirname, '..', 'tools', 'scenarios', name), 'utf8');
    // align --kind serviceTask --axis column: the service task of the assessment sub-process stayed behind its moved frame
    const anno = await run(scenario('agent__anno2.bpmn'), [{ op: 'align', kind: 'serviceTask', axis: 'column' }]);
    expect(anno.result.layout.format?.[0]?.notes).toContainEqual(expect.stringMatching(/^left out Activity_CheckCoverage \(sub-process Activity_AssessClaim\)/));
    expect(outsideSub(anno.doc)).toEqual([]);
    expect((anno.result.layout.metrics?.added ?? []).filter((problem) => problem.kind.startsWith('outside'))).toEqual([]);
    // every end event onto the column of an outer one, named explicitly
    const claim = scenario('agent__claim.noanno.bpmn');
    const cliError = await failure(claim, [{ op: 'align', ids: ['Event_AssessmentDone', 'Event_NotCovered', 'Event_ClaimRejected', 'Event_ManagerInformed', 'Event_ClaimSettled', 'Event_2', 'Event_Reminded'], axis: 'column', to: 'Event_Reminded' }]);
    expect(cliError).toMatchObject({ code: 'E_LEAVES_CONTAINER', element: 'Event_AssessmentDone', related: ['Activity_AssessClaim'] });
    const kind = await run(claim, [{ op: 'align', kind: 'endEvent', axis: 'column' }]);
    expect(outsideSub(kind.doc)).toEqual([]);
    expect((kind.result.layout.metrics?.added ?? []).filter((problem) => problem.kind.startsWith('outside'))).toEqual([]);
  });
});

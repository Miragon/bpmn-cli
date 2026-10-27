/**
 * Regressions found while gating step 1 of the 2026-10 audit fixes (the
 * benchmark on drawings of an earlier engine version and on modeler files).
 *
 *  - fitInFrame never grows an ancestor frame that the drawing does not put
 *    the inner frame into (its centre lies outside): growing it would move the
 *    inner frame away from the shape that grew (a task torn out of its event
 *    sub-process, `outsideSub`)
 *  - removing a sequence flow also drops stale mirror entries of it
 *    (`<bpmn:incoming>` on a node the flow does not touch), so a bridged
 *    remove on such a modeler file no longer fails with E_DANGLING_REF (the
 *    second test, removing the flow itself, is a guard: remove's reference
 *    cascade already handled it)
 *  - `place` / `align` never leave two shapes on each other that did not
 *    overlap before: when the shapes around a row reference made room and
 *    the reference stayed, the reference moves with them (the row still
 *    holds), else E_NO_ROOM
 *
 * The fixtures in test/fixtures/gate/ are small synthetic drawings.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Doc } from '../../../src/domain/document/Doc.js';
import { diffProblems } from '../../../src/domain/diagram/utils/problems.js';
import type { DShape } from '../../../src/domain/diagram/di/types.js';
import { LayoutAnalysis } from '../../../src/domain/diagram/di/LayoutAnalysis.js';
import { DiagramReader } from '../../../src/domain/diagram/di/DiagramReader.js';
import type { El } from '../../../src/domain/document/utils/moddle.js';
import type { EditCommand } from '../../../src/domain/commands/types.js';
import { mutateDoc } from '../../../src/index.js';
import { type MutationOptions, type MutationResult } from '../../../src/domain/batch/types.js';
import { validateDoc } from '../../../src/index.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARD = new Set(['overlaps', 'through', 'missing', 'outsideLane', 'outsidePool', 'outsideSub', 'frameIntrusion', 'frameOverlap', 'degenerateEdge']);

const fixture = (name: string): string => readFileSync(join(HERE, 'fixtures', 'gate', name), 'utf8');

async function run(xml: string, ops: EditCommand[], opts: MutationOptions = {}): Promise<{ result: MutationResult; after: Doc }> {
  const result = await mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, ...opts });
  const after = await Doc.fromXml(result.xml);
  expect(after.importWarnings).toEqual([]);
  return { result, after };
}

function shapes(doc: Doc): Map<string, DShape> {
  const out = new Map<string, DShape>();
  for (const plane of new DiagramReader(doc.definitions).planes()) for (const shape of plane.shapes.values()) if (!out.has(shape.id)) out.set(shape.id, shape);
  return out;
}

const ids = (els: El[] | undefined): string[] => (els ?? []).map((element) => element.get<string>('id'));

describe('fitInFrame keeps an inner frame with its content when the drawing has it outside its lane', () => {
  const LONG = 'Check all submitted documents thoroughly and inform the responsible clerk about the outcome';

  it('a renamed task grows inside its event sub-process; the sub-process is not pulled into its member lane', async () => {
    const xml = fixture('eventsub-wrong-lane.bpmn');
    const before = await Doc.fromXml(xml);
    const { result, after } = await run(xml, [{ op: 'set', id: 'R', values: { name: LONG } }], { layout: 'incremental' });
    expect(result.layout.mode).toBe('incremental');
    const added = diffProblems(LayoutAnalysis.of(before.definitions).problems, LayoutAnalysis.of(after.definitions).problems).added;
    expect(added.filter((problem) => HARD.has(problem.kind))).toEqual([]);
    const beforeShapes = shapes(before);
    const afterShapes = shapes(after);
    // the task grew and stays inside its sub-process, which stays where the drawing has it
    expect(afterShapes.get('R')!.bounds.width).toBeGreaterThan(beforeShapes.get('R')!.bounds.width);
    const esp = afterShapes.get('Esp')!.bounds;
    const task = afterShapes.get('R')!.bounds;
    expect(task.x).toBeGreaterThanOrEqual(esp.x);
    expect(task.y).toBeGreaterThanOrEqual(esp.y);
    expect(task.x + task.width).toBeLessThanOrEqual(esp.x + esp.width);
    expect(task.y + task.height).toBeLessThanOrEqual(esp.y + esp.height);
    expect(esp.y).toBe(beforeShapes.get('Esp')!.bounds.y);
    // the lanes keep their bands: nothing outside the sub-process's row moved down
    for (const id of ['L1', 'L2', 'A', 'B', 'E']) expect(afterShapes.get(id)!.bounds.y).toBe(beforeShapes.get(id)!.bounds.y);
    expect(afterShapes.get('L1')!.bounds.height).toBe(beforeShapes.get('L1')!.bounds.height);
  });
});

describe('removing a sequence flow drops stale mirror entries of it', () => {
  it('a bridged remove next to a stale <incoming> entry writes without --force and leaves no dangling reference', async () => {
    const xml = fixture('stale-flow-list.bpmn');
    const { result, after } = await run(xml, [{ op: 'remove', ids: ['T'] }]);
    expect(result.changes.removed.map((removed) => removed.id)).toEqual(expect.arrayContaining(['T', 'F2']));
    const end = after.require('End');
    expect(ids(end.get<El[]>('incoming'))).toEqual(['F3']);
    expect(after.require('F1').get<El>('targetRef').get<string>('id')).toBe('Sub');
    const codes = validateDoc(after).errors.map((error) => error.code);
    expect(codes).not.toContain('E_DANGLING_REF');
    expect(codes).not.toContain('E_FLOW_LINKS');
  });

  it('removing the flow itself also clears the stale entry', async () => {
    const xml = fixture('stale-flow-list.bpmn');
    const { after } = await run(xml, [{ op: 'remove', ids: ['F2'] }]);
    expect(ids(after.require('End').get<El[]>('incoming'))).toEqual(['F3']);
    expect(ids(after.require('Sub').get<El[]>('incoming'))).toEqual([]);
    expect(validateDoc(after).errors.map((error) => error.code)).not.toContain('E_DANGLING_REF');
  });
});

describe('making room for place / align never leaves a new overlap', () => {
  it('a row reference the neighbours were pushed onto moves along; the row still holds', async () => {
    const xml = fixture('place-pinned-row.bpmn');
    const before = await Doc.fromXml(xml);
    const { result, after } = await run(xml, [{ op: 'place', ids: ['M'], rowOf: 'J', after: 'X' }]);
    const added = diffProblems(LayoutAnalysis.of(before.definitions).problems, LayoutAnalysis.of(after.definitions).problems).added;
    expect(added.filter((problem) => HARD.has(problem.kind))).toEqual([]);
    const afterShapes = shapes(after);
    const centreY = (id: string): number => afterShapes.get(id)!.bounds.y + afterShapes.get(id)!.bounds.height / 2;
    expect(centreY('M')).toBe(centreY('J'));
    expect(afterShapes.get('M')!.bounds.x).toBeGreaterThan(afterShapes.get('X')!.bounds.x + afterShapes.get('X')!.bounds.width);
    const [branchBox, joinBox] = [afterShapes.get('B')!.bounds, afterShapes.get('J')!.bounds];
    expect(branchBox.x + branchBox.width).toBeLessThanOrEqual(joinBox.x);
    expect(result.layout.format?.[0]?.moved).toContain('J');
  });
});

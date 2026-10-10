/**
 * Mutation output as a delta (step 3, audit #60): a result lists the
 * warnings the change added and resolved and only counts the ones the file
 * already had; floods of one code are one line; `--summary` (mutationSummary)
 * is created ids by kind, the added warnings and one layout line. Synthetic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml, newXml } from '../src/api.js';
import { mutationSummary, renderMutation, renderSummary, warningLines } from '../src/report.js';
import { definitionsXml } from './helpers.js';

const ROOT = join(import.meta.dirname, '..');
const CLAIMS = readFileSync(join(ROOT, 'test', 'fixtures', 'views', 'claims.bpmn'), 'utf8');

const codes = (ws: Array<{ code: string; element?: string }>): string[] => ws.map((w) => `${w.code} ${w.element ?? ''}`.trim());

/** start -> T1 -> T2 -> T3 -> end, plus an unconnected task Loose (W_UNREACHABLE, W_DEAD_END) and two tasks named "Twin" (W_DUPLICATE_NAME). */
const CHAIN = definitionsXml(`
    <bpmn:startEvent id="Start"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T1" name="Twin"><bpmn:incoming>F0</bpmn:incoming><bpmn:outgoing>F1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T2" name="Twin"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T3" name="Three"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:task id="Loose" name="Loose" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="T1" />
    <bpmn:sequenceFlow id="F1" sourceRef="T1" targetRef="T2" />
    <bpmn:sequenceFlow id="F2" sourceRef="T2" targetRef="T3" />
    <bpmn:sequenceFlow id="F3" sourceRef="T3" targetRef="End" />`);

describe('warnings as a delta', () => {
  it('an edit that touches none of them only counts the warnings the file already had', async () => {
    const r = await applyToXml(CHAIN, [{ op: 'set', id: 'T3', values: { name: 'Third' } }], { layout: false });
    expect(r.result.warnings).toEqual({ added: [], resolved: [], preexistingCount: 3 });
    expect(r.result.validation).not.toHaveProperty('warnings');
    const text = renderMutation(r.result);
    expect(text).not.toMatch(/W_UNREACHABLE|W_DEAD_END|W_DUPLICATE_NAME/);
    expect(text).toContain('3 warnings already in the file (not repeated: `bpmn validate <file>` lists them)');
  });

  it('lists what the change added and what it resolved', async () => {
    const r = await applyToXml(CHAIN, [{ op: 'connect', source: 'Loose', target: 'End' }, { op: 'set', id: 'T2', values: { name: 'Second' } }, { op: 'add', kind: 'task', name: 'Stray', in: 'Process_1', id: 'Stray' }], { layout: false });
    // the new flow into End makes it an implicit join
    expect(codes(r.result.warnings.added)).toEqual(['W_UNREACHABLE Stray', 'W_IMPLICIT_JOIN End', 'W_DEAD_END Stray']);
    expect(codes(r.result.warnings.resolved)).toEqual(['W_DEAD_END Loose', 'W_DUPLICATE_NAME T1']);
    expect(r.result.warnings.preexistingCount).toBe(1); // Loose is still unreachable
    const text = renderMutation(r.result);
    expect(text).toContain('warning W_UNREACHABLE Stray: ');
    expect(text).toContain('resolved: W_DEAD_END Loose, W_DUPLICATE_NAME T1');
    expect(text).toContain('1 warning already in the file');
  });

  it('a warning follows its element through a rename (it stays pre-existing)', async () => {
    const r = await applyToXml(CHAIN, [{ op: 'set', id: 'Loose', values: { id: 'Loose_Renamed' } }], { layout: false });
    expect(r.result.warnings.added).toEqual([]);
    expect(r.result.warnings.resolved).toEqual([]);
    expect(r.result.warnings.preexistingCount).toBe(3);
  });

  it('an error the file had and the change fixed is resolved; one it keeps is counted', async () => {
    const twoLanes = definitionsXml(`
    <bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2"><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="S"><bpmn:outgoing>G1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="A" name="A"><bpmn:incoming>G1</bpmn:incoming><bpmn:outgoing>G2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E"><bpmn:incoming>G2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="G1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="G2" sourceRef="A" targetRef="E" />`);
    const kept = await applyToXml(twoLanes, [{ op: 'set', id: 'E', values: { name: 'Done' } }], { layout: false });
    expect(kept.result.warnings.added).toEqual([]);
    expect(kept.result.warnings.preexistingCount).toBeGreaterThanOrEqual(1); // W_PREEXISTING_ERROR E_LANE_CONFLICT A
    const fixed = await applyToXml(twoLanes, [{ op: 'set', id: 'A', values: { lane: 'L1' } }], { layout: false });
    expect(codes(fixed.result.warnings.resolved)).toContain('E_LANE_CONFLICT A');
  });

  it('three or more warnings of one code are one line with the ids', async () => {
    const r = await applyToXml(CHAIN, [{ op: 'remove', ids: ['F0'] }], { layout: false });
    const unreachable = r.result.warnings.added.filter((w) => w.code === 'W_UNREACHABLE');
    expect(unreachable.map((w) => w.element)).toEqual(['T1', 'T2', 'T3', 'End']);
    const text = renderMutation(r.result);
    const lines = text.split('\n').filter((l) => l.includes('W_UNREACHABLE'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^warning W_UNREACHABLE x4 \[T1, T2, T3, End\]: task T1 "Twin" is not reachable from any start event/);
    // two of a code stay two lines
    expect(warningLines([{ code: 'W_A', message: 'a', element: 'X' }, { code: 'W_A', message: 'b', element: 'Y' }])).toEqual(['warning W_A X: a', 'warning W_A Y: b']);
  });

  it('a new document reports its warnings (there was no file before)', async () => {
    const created = await newXml({ processName: 'Fresh' });
    expect(codes(created.result.warnings.added)).toEqual(['W_NO_START Process_Fresh', 'W_NO_END Process_Fresh']);
    expect(created.result.warnings.preexistingCount).toBe(0);
  });

  it('the pre-existing warnings of a large real-world-like file are not repeated on every write', async () => {
    const r = await applyToXml(CLAIMS, [{ op: 'set', id: 'Activity_Pay', values: { name: 'Pay the claim' } }], { layout: false });
    expect(r.result.warnings).toEqual({ added: [], resolved: [], preexistingCount: 1 }); // W_IMPLICIT_JOIN Activity_SendDecision
    expect(renderMutation(r.result)).not.toContain('W_IMPLICIT_JOIN');
  });
});

describe('--summary (mutationSummary / renderSummary)', () => {
  it('created ids by kind, changed / removed ids, the added warnings, one layout line', async () => {
    const r = await applyToXml(CHAIN, [
      { op: 'add', kind: 'userTask', name: 'Review', after: 'T3', id: 'Review' },
      { op: 'add', kind: 'userTask', name: 'Approve', after: 'Review', id: 'Approve' },
      { op: 'remove', ids: ['Loose'] },
    ]);
    const summary = mutationSummary(r.result);
    expect(summary.created).toEqual({ userTask: ['Review', 'Approve'], sequenceFlow: [expect.any(String), expect.any(String)] });
    expect(summary.removed).toEqual(['Loose']);
    expect(summary.changed.length).toBeGreaterThan(0);
    expect(summary.warnings).toEqual({ added: [], resolvedCount: 2, preexistingCount: 1 });
    expect(summary.layout).toMatchObject({ status: 'ok', mode: 'full', score: { after: expect.any(Number) } });
    const text = renderSummary(summary);
    const lines = text.split('\n');
    expect(lines[0]).toBe('created userTask: Review, Approve');
    expect(lines[1]).toMatch(/^created sequenceFlow: \S+, \S+$/);
    expect(lines).toContain('removed: Loose');
    expect(lines).toContain('warnings: 0 added, 2 resolved, 1 already in the file');
    expect(lines.at(-1)).toMatch(/^layout: full, score \d+$/);
    // much shorter than the full result
    expect(text.length).toBeLessThan(renderMutation(r.result).length);
  });

  it('a result without changes says so', async () => {
    const r = await applyToXml(CHAIN, [{ op: 'remove', ids: ['Nothing'], ifExists: true }], { layout: false });
    expect(r.unchanged).toBe(true);
    // a file without a drawing: the layout line counts its problems instead of listing them
    expect(renderSummary(mutationSummary(r.result)).split('\n')).toEqual([
      'no changes',
      'warnings: 0 added, 0 resolved, 3 already in the file',
      'layout: skipped, score 100 (10 layout problems: `bpmn metrics <file>` lists them)',
    ]);
  });
});

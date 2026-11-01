import { describe, expect, it } from 'vitest';
import { EditResultText } from '../../../src/cli/output/EditResultText.js';

const SCORE = { before: { score: 4 }, after: { score: 9 }, added: [], resolved: [] };
const RESULT = { unchanged: false, created: [], changed: [], removed: [], renamed: [], aliases: {}, findings: [], preexisting: [], state: { errors: 0, warnings: 0 }, score: SCORE, format: [], notes: [] };

const textOf = (changes: object = {}, report: object = {}) => new EditResultText({ ...RESULT, ...changes } as never, { file: 'f.bpmn', written: true, dryRun: false, ...report }).text();
const change = (id: string, kind = 'task') => ({ id, kind });

describe('EditResultText', () => {
  it('ends with the score, the state and the file', () => {
    expect(textOf().split('\n')).toEqual(['no changes', 'layout quality: score 4 -> 9', "state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)", 'written: f.bpmn']);
  });

  it('names what the score added and resolved, ids of two with an x', () => {
    const score = { ...SCORE, added: [{ kind: 'crossings', ids: ['a', 'b'] }], resolved: [{ kind: 'overlaps', ids: ['c'], detail: 'wide' }] };

    expect(textOf({ score })).toContain('layout quality: score 4 -> 9; added: crossings a x b; resolved: overlaps c wide');
    expect(textOf({ score: { ...score, before: undefined } })).toContain('layout quality: score 9; problems: crossings a x b');
  });

  it('groups what it created by kind, and leaves it out of what changed', () => {
    const text = textOf({ created: [change('a'), change('b', 'userTask')], changed: [change('a'), change('c')], removed: [change('')], renamed: [{ from: 'x', to: 'y' }], aliases: { $a: 'a' } });

    expect(text.split('\n').slice(0, 6)).toEqual(['created task: a', 'created userTask: b', 'aliases: $a = a', 'changed: c', 'renamed: x -> y', 'removed: (no id)']);
  });

  it('prints what a drawing operation did, and that it did nothing', () => {
    const format = [{ op: 'place', index: 0, moved: ['a'], rerouted: ['f'], colored: ['a'], labels: ['b'], notes: ['n'] }, { op: 'tidy', index: 1, moved: [], rerouted: [] }];

    expect(textOf({ format })).toContain('format place #0: colored a; label placed b; moved a; rerouted f; note: n\nformat tidy #1: no change');
  });

  it('names an id once, however many changes it took', () => {
    expect(textOf({ changed: [change('a'), change('a')] })).toContain('changed: a\n');
  });

  it('tells a dry run, an unchanged file and a copy of it apart', () => {
    expect(textOf({}, { written: false, dryRun: true })).toContain('dry run: f.bpmn not written\n'.trimEnd());
    expect(textOf({ unchanged: true }, { written: false, dryRun: true })).toContain('not written (unchanged)');
    expect(textOf({ unchanged: true }, { written: false })).toContain('unchanged: f.bpmn');
    expect(textOf({ unchanged: true })).toContain('written: f.bpmn (unchanged copy of the input)');
  });

  it('prints forced errors and warnings', () => {
    const findings = [{ code: 'E_A', message: 'a', severity: 'error' }, { code: 'W_B', message: 'b', severity: 'warning' }];

    expect(textOf({ findings })).toContain('forced E_A: a\nwarning W_B: b');
  });

  it('stays within 1 KB and says how much it left out', () => {
    const created = Array.from({ length: 200 }, (_, index) => change(`task_${index}`, `kind${index}`));
    const text = textOf({ created });

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(EditResultText.MAX_BYTES);
    expect(text).toMatch(/\.\.\. \d+ more lines \(--json lists them\)\nlayout quality/);
    expect(text.endsWith('written: f.bpmn')).toBe(true);
  });

  it('cuts a long list of ids', () => {
    const removed = Array.from({ length: 10 }, (_, index) => change(`t${index}`));

    expect(textOf({ removed })).toContain('t7 (+2 more)');
  });
});

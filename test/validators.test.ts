/**
 * The validation hook of the write pipeline (src/validators.ts,
 * MutationOptions.validators) and the design profile on mutations
 * (MutationOptions.profile, `--profile`). A validator sees the candidate XML
 * after the layout and the format ops; errors a change introduces block the
 * write, errors the file already had do not (all models synthetic).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import type { Warning } from '../src/errors.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc, mutateFile, type MutationOptions } from '../src/pipeline.js';
import { compareRuns, type ValidatorContext, type ValidatorFinding, type ValidatorRun } from '../src/validators.js';

const ROOT = join(import.meta.dirname, '..');
const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const xml = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:process id="P" isExecutable="false">
${body}
</bpmn:process>
</bpmn:definitions>`;
const LINE = xml(`<bpmn:startEvent id="S" /><bpmn:task id="A" name="Check" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E" />`);
/** A has no outgoing flow and E no incoming one: a dead end and an unreachable end the file already has */
const DEAD_END = xml(`<bpmn:startEvent id="S" /><bpmn:task id="A" name="Check" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />`);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-validators-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A drawn model in a file of its own. */
async function drawn(name: string, source: string): Promise<string> {
  const file = join(dir, name);
  const laid = await mutateDoc(await Doc.fromXml(source), [], { dryRun: true, layout: 'full', profile: 'none' });
  writeFileSync(file, laid.xml);
  return file;
}

async function refusal(file: string, ops: Op[], opts: MutationOptions): Promise<{ code: string; errors: Array<Warning & { validator?: string }> }> {
  const before = readFileSync(file, 'utf8');
  try {
    await mutateFile(file, ops, opts);
  } catch (err) {
    expect(readFileSync(file, 'utf8'), 'nothing written').toBe(before);
    const e = err as { code: string; details: { errors?: Array<Warning & { validator?: string }> } };
    return { code: e.code, errors: e.details.errors ?? [] };
  }
  throw new Error('the write was not refused');
}

const codes = (ws: Warning[]): string[] => ws.map((w) => `${(w as { validator?: string }).validator ? `[${(w as { validator?: string }).validator}] ` : ''}${w.code}${w.element ? ` ${w.element}` : ''}`);

describe('design profile on mutations', () => {
  it('refuses a change that introduces a design error; the same change passes without the profile', async () => {
    const file = await drawn('line.bpmn', LINE);
    const ops: Op[] = [{ op: 'add', kind: 'task', name: 'Loose', in: 'P' }];
    const r = await refusal(file, ops, { profile: 'design' });
    expect(r.code).toBe('E_VALIDATION');
    expect(codes(r.errors)).toEqual(['[design] E_DESIGN_UNREACHABLE Activity_Loose', '[design] E_DESIGN_DEAD_END Activity_Loose']);
    expect(r.errors[0]).toMatchObject({ validator: 'design', severity: 'error' });
    const plain = await mutateFile(file, ops, { dryRun: true, profile: 'none' });
    expect(plain.validation.validators).toBeUndefined();
    expect(codes(plain.validation.warnings)).toEqual(expect.arrayContaining(['W_UNREACHABLE Activity_Loose', 'W_DEAD_END Activity_Loose']));
  });

  it('--force writes it and reports the errors with the validator', async () => {
    const file = await drawn('forced.bpmn', LINE);
    const result = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Loose', in: 'P' }], { profile: 'design', force: true });
    expect(result.written).toBe(true);
    expect(codes(result.validation.errors)).toEqual(['[design] E_DESIGN_UNREACHABLE Activity_Loose', '[design] E_DESIGN_DEAD_END Activity_Loose']);
    expect(result.validation.validators).toEqual([expect.objectContaining({ name: 'design', counts: { errors: 2, warnings: 0 }, preexisting: [], resolved: [] })]);
    // the lint warnings about the same node are not repeated next to the design errors
    expect(codes(result.validation.warnings)).not.toContain('W_DEAD_END Activity_Loose');
  });

  it('an error the file already had does not block an edit; it is reported as W_PREEXISTING_ERROR and follows a rename', async () => {
    const file = await drawn('dead-end.bpmn', DEAD_END);
    const renamed = await mutateFile(file, [{ op: 'set', id: 'A', values: { id: 'Activity_Check', name: 'Check order' } }], { profile: 'design' });
    expect(renamed.written).toBe(true);
    const pre = renamed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR' && (w as { validator?: string }).validator === 'design');
    expect(pre.map((w) => [w.element, w.message])).toEqual([
      ['Activity_Check', 'E_DESIGN_DEAD_END: task Activity_Check "Check order" has no outgoing sequence flow (already in the model before this change)'],
      ['E', 'E_DESIGN_UNREACHABLE: endEvent E has no incoming sequence flow (already in the model before this change)'],
    ]);
    expect(renamed.validation.validators?.[0]).toMatchObject({ errors: [], preexisting: [expect.objectContaining({ code: 'E_DESIGN_DEAD_END' }), expect.objectContaining({ code: 'E_DESIGN_UNREACHABLE' })] });
    // fixing them resolves them
    const fixed = await mutateFile(file, [{ op: 'connect', source: 'Activity_Check', target: 'E' }], { profile: 'design' });
    expect(fixed.validation.validators?.[0]).toMatchObject({
      errors: [],
      preexisting: [],
      resolved: [expect.objectContaining({ code: 'E_DESIGN_DEAD_END', element: 'Activity_Check' }), expect.objectContaining({ code: 'E_DESIGN_UNREACHABLE', element: 'E' })],
      counts: { errors: 0, warnings: 0 },
    });
  });

  it('a second start event is refused even with its path (one per process); a node and its flows in one transaction pass', async () => {
    const file = await drawn('starts.bpmn', LINE);
    const second = await refusal(file, [{ op: 'add', kind: 'startEvent', name: 'Retry', in: 'P' }, { op: 'connect', source: 'Event_Retry', target: 'A' }], { profile: 'design' });
    expect(codes(second.errors)).toEqual(['[design] E_DESIGN_START_EVENTS S', '[design] E_DESIGN_START_EVENTS Event_Retry']);
    const alone = await refusal(file, [{ op: 'add', kind: 'task', name: 'Parallel', in: 'P' }], { profile: 'design' });
    expect(alone.errors).toHaveLength(2);
    const batch = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Parallel', in: 'P' }, { op: 'connect', source: 'A', target: 'Activity_Parallel' }, { op: 'connect', source: 'Activity_Parallel', target: 'E' }], { profile: 'design', dryRun: true });
    expect(batch.validation.validators?.[0]?.errors).toEqual([]);
  });

  it('a process that already has two start events: a third is refused, removing one is not', async () => {
    const two = xml(`<bpmn:startEvent id="S" /><bpmn:startEvent id="S2" /><bpmn:task id="A" name="Check" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F0" sourceRef="S2" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E" />`);
    const file = await drawn('two-starts.bpmn', two);
    const third = await refusal(file, [{ op: 'add', kind: 'startEvent', name: 'Third', in: 'P' }, { op: 'connect', source: 'Event_Third', target: 'A' }], { profile: 'design' });
    expect(codes(third.errors)).toEqual(['[design] E_DESIGN_START_EVENTS Event_Third']);
    const removed = await mutateFile(file, [{ op: 'remove', ids: ['S2'] }], { profile: 'design', dryRun: true });
    expect(removed.validation.validators?.[0]).toMatchObject({ errors: [], resolved: [expect.objectContaining({ element: 'S' }), expect.objectContaining({ element: 'S2' })] });
  });

  it('warnings a change introduces are reported once; later writes only count them', async () => {
    const file = await drawn('complex.bpmn', LINE);
    const ops: Op[] = Array.from({ length: 9 }, (_, i) => ({ op: 'add', kind: 'task', name: `Step ${i}`, after: i === 0 ? 'A' : `Activity_Step${i - 1}` }));
    const grown = await mutateFile(file, ops, { profile: 'design' });
    expect(codes(grown.validation.warnings).filter((c) => c.includes('DESIGN'))).toEqual(['[design] W_DESIGN_COMPLEXITY P']);
    const again = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'One more', after: 'Activity_Step8' }], { profile: 'design' });
    expect(codes(again.validation.warnings).filter((c) => c.includes('DESIGN'))).toEqual([]);
    expect(again.validation.validators?.[0]?.counts).toEqual({ errors: 0, warnings: 1 });
  });

  it('never changes what is written: the same edit gives the same bytes with and without the profile', async () => {
    const lanes = await drawn(
      'bytes.bpmn',
      xml(`<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
<bpmn:startEvent id="S" /><bpmn:businessRuleTask id="A" name="Check" calledDecision="d" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E" />`),
    );
    for (const ops of [[{ op: 'set', id: 'A', values: { name: 'Checked' } }], [{ op: 'add', kind: 'task', name: 'Next', after: 'A' }]] as Op[][]) {
      const without = await mutateFile(lanes, ops, { dryRun: true, profile: 'none' });
      const withProfile = await mutateFile(lanes, ops, { dryRun: true, profile: 'design' });
      expect(withProfile.xml).toBe(without.xml);
    }
  });

  it('checks what would be written: without the layout a new node has no shape (E_DESIGN_NO_DI)', async () => {
    const file = await drawn('no-layout.bpmn', LINE);
    const r = await refusal(file, [{ op: 'add', kind: 'task', name: 'Inserted', after: 'A' }], { profile: 'design', layout: false });
    expect(codes(r.errors)).toEqual(['[design] E_DESIGN_NO_DI Activity_Inserted', '[design] E_DESIGN_NO_DI Flow_1']);
    expect((await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Inserted', after: 'A' }], { profile: 'design', dryRun: true })).validation.validators?.[0]?.errors).toEqual([]);
  });
});

describe('host validators (MutationOptions.validators)', () => {
  /** design-iq's Finding shape: ERROR / WARN, ruleId, a message naming the element, no element field */
  const unnamedTasks = (xml: string): ValidatorFinding[] =>
    [...xml.matchAll(/<bpmn:task id="([^"]+)"(?![^>]*name=)/g)].map((m) => ({ severity: 'ERROR', ruleId: 'naming/task', message: `task ${m[1]} has no name` }));

  it('design-iq shaped findings: an introduced ERROR blocks, a pre-existing one (matched by message, renames followed) does not', async () => {
    const file = await drawn('host.bpmn', LINE);
    const r = await refusal(file, [{ op: 'add', kind: 'task', after: 'A' }], { profile: 'none', validators: [unnamedTasks] });
    expect(r.errors).toEqual([{ code: 'naming/task', message: 'task Activity_1 has no name', validator: 'unnamedTasks', severity: 'error' }]);

    const unnamed = await drawn('host-unnamed.bpmn', LINE.replace(' name="Check"', ''));
    const renamed = await mutateFile(unnamed, [{ op: 'set', id: 'A', values: { id: 'Activity_Old' } }], { profile: 'none', validators: [{ name: 'design-iq', validate: unnamedTasks }] });
    expect(renamed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR')).toEqual([
      { code: 'W_PREEXISTING_ERROR', message: 'naming/task: task Activity_Old has no name (already in the model before this change)', validator: 'design-iq', severity: 'warning' },
    ]);
    expect(renamed.validation.validators).toEqual([{ name: 'design-iq', errors: [], warnings: [], preexisting: [expect.objectContaining({ code: 'naming/task' })], resolved: [], counts: { errors: 1, warnings: 0 } }]);
  });

  it('runs before and after with a context; the candidate is the laid-out XML; async validators work', async () => {
    const file = await drawn('ctx.bpmn', LINE);
    const seen: Array<{ phase: string; file?: string; platform: string; ops: number; shape: boolean; doc: boolean }> = [];
    const spy = async (x: string, ctx: ValidatorContext): Promise<ValidatorFinding[]> => {
      const doc = await ctx.doc();
      seen.push({ phase: ctx.phase, file: ctx.file, platform: ctx.platform, ops: ctx.ops.length, shape: x.includes('bpmnElement="Activity_New"'), doc: !!doc.get('A') });
      return ctx.phase === 'after' ? [{ severity: 'warning', code: 'W_HOST', message: 'checked', element: 'Activity_New' }] : [];
    };
    const result = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'New', after: 'A' }], { profile: 'none', validators: [spy] });
    expect(seen).toEqual([
      { phase: 'before', file, platform: 'none', ops: 1, shape: false, doc: true },
      { phase: 'after', file, platform: 'none', ops: 1, shape: true, doc: true },
    ]);
    expect(result.validation.warnings.at(-1)).toEqual({ code: 'W_HOST', message: 'checked', element: 'Activity_New', validator: 'spy', severity: 'warning' });
  });

  it('a validator that throws fails the write (E_VALIDATOR_FAILED); a bad validator is refused', async () => {
    const file = await drawn('throws.bpmn', LINE);
    const r = await refusal(file, [{ op: 'set', id: 'A', values: { name: 'X' } }], { profile: 'none', validators: [{ name: 'broken', validate: () => { throw new Error('boom'); } }] });
    expect(r.code).toBe('E_VALIDATOR_FAILED');
    const notArray = await refusal(file, [{ op: 'set', id: 'A', values: { name: 'X' } }], { profile: 'none', validators: [{ name: 'odd', validate: () => 'nope' as unknown as ValidatorFinding[] }] });
    expect(notArray.code).toBe('E_VALIDATOR_FAILED');
    await expect(mutateFile(file, [], { validators: [{ name: 'x' } as never] })).rejects.toMatchObject({ code: 'E_VALIDATOR_FAILED' });
  });

  it('message matching follows renames in one pass: two ids swapped in one batch stay apart', () => {
    const run = (messages: string[]): ValidatorRun[] => [{ name: 'host', issues: messages.map((message) => ({ code: 'naming/task', message, validator: 'host', severity: 'error' as const })) }];
    const swapped = compareRuns(run(['task A has no name', 'task B has a typo']), run(['task B has no name', 'task A has a typo']), new Map([['A', 'B'], ['B', 'A']]));
    expect(swapped[0]).toMatchObject({ errors: [], resolved: [], preexisting: [expect.objectContaining({ message: 'task B has no name' }), expect.objectContaining({ message: 'task A has a typo' })] });
    // A.B is another id than A: renaming A leaves it alone
    const dotted = compareRuns(run(['task A.B has no name']), run(['task A.B has no name']), new Map([['A', 'X']]));
    expect(dotted[0]!.errors).toEqual([]);
  });

  it('in-memory documents (no file) run the host validators, but no auto profile', async () => {
    const doc = await Doc.fromXml(LINE);
    let phases = 0;
    const result = await mutateDoc(doc, [{ op: 'set', id: 'A', values: { name: 'Y' } }], { dryRun: true, validators: [() => (phases++, [])] });
    expect(phases).toBe(2);
    expect(result.validation.validators?.map((r) => r.name)).toEqual(['validator1']);
  });
});

describe('design profile: auto in a content repository, and the CLI', () => {
  it('auto turns it on for a model of a bpmiq.yml repository; --profile none turns it off; output names the validator', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'processes'), { recursive: true });
    writeFileSync(join(repo, 'bpmiq.yml'), 'models: processes\n');
    const file = join(repo, 'processes', 'order.bpmn');
    writeFileSync(file, readFileSync(await drawn('repo-line.bpmn', LINE), 'utf8'));
    const before = readFileSync(file, 'utf8');

    const refused = cli('add', file, 'task', 'Loose', '--in', 'P');
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('error E_VALIDATION: The change would introduce 2 error(s) reported by validator design; nothing was written');
    expect(refused.err).toContain('  [design] E_DESIGN_UNREACHABLE Activity_Loose: task Activity_Loose "Loose" has no incoming sequence flow');
    expect(refused.err).toContain('--profile none');
    expect(readFileSync(file, 'utf8')).toBe(before);

    const json = JSON.parse(cli('add', file, 'task', 'Loose', '--in', 'P', '--json').err);
    expect(json.error.errors[0]).toMatchObject({ code: 'E_DESIGN_UNREACHABLE', validator: 'design' });

    const ok = cli('add', file, 'task', 'Loose', '--in', 'P', '--profile', 'none', '--dry-run');
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).not.toContain('validator design');

    const inserted = cli('add', file, 'task', 'Review', '--after', 'A');
    expect(inserted.code, inserted.err).toBe(0);
    expect(inserted.out).toContain(`validator design (bpmiq.yml in ${repo}: a design-iq content repository): 0 error(s), 0 warning(s) in the result`);

    const forced = cli('add', file, 'task', 'Loose', '--in', 'P', '--force');
    expect(forced.code).toBe(0);
    expect(forced.out).toContain('forced [design] E_DESIGN_UNREACHABLE Activity_Loose');
    const pre = cli('set', file, 'Activity_Loose', 'name=Still loose');
    expect(pre.out).toContain('warning [design] W_PREEXISTING_ERROR Activity_Loose: E_DESIGN_UNREACHABLE');
    expect(cli('set', file, 'Activity_Loose', 'name=x', '--profile', 'bogus').code).toBe(1);
    expect(existsSync(`${file}.bak`)).toBe(false);
  }, 60000);

  it('the DESIGN-IQ recipe of the guide: a boundary event alone is refused, with its path in one transaction it is written', async () => {
    const repo = join(dir, 'recipe');
    mkdirSync(join(repo, 'models'), { recursive: true });
    writeFileSync(join(repo, 'bpmiq.yml'), 'models: models\n');
    const file = join(repo, 'models', 'review.bpmn');
    writeFileSync(file, readFileSync(await drawn('recipe-line.bpmn', LINE.replace(/"A"/g, '"Activity_Review"')), 'utf8'));
    const alone = cli('add', file, 'boundary:timer', '2 days', '--on', 'Activity_Review', '--timer', 'PT2D');
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('[design] E_DESIGN_DEAD_END Event_2Days');
    const ops = join(dir, 'recipe.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'boundary:timer', name: '2 days', on: 'Activity_Review', timer: 'PT2D' }, { op: 'add', kind: 'end', name: 'Escalated', after: 'Event_2Days' }]));
    const batch = cli('apply', file, ops);
    expect(batch.code, batch.err).toBe(0);
    expect(batch.out).toContain('validator design');
  }, 60000);
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

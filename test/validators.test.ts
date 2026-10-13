/**
 * The validator hook (src/validators.ts): MutationOptions.validators on
 * writes, CheckOptions.validators on validate. A validator sees the candidate
 * XML after the layout and the format ops; errors a change introduces block
 * the write, errors the file already had do not (all models synthetic). The
 * validators are a host's (library use): the CLI takes none, and `--profile`
 * is an unknown option like any other.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateXml } from '../src/api.js';
import { Doc } from '../src/document.js';
import type { CliError, Warning } from '../src/errors.js';
import { is, type El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { checkFile, mutateFile } from '../src/node/files.js';
import { mutateDoc, type MutationOptions } from '../src/pipeline.js';
import { mutationReport, renderMutation, renderValidation, validationReport, validatorTag } from '../src/report.js';
import { compareRuns, type NamedValidator, type ValidatorContext, type ValidatorFinding, type ValidatorRun } from '../src/validators.js';

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
  const laid = await mutateDoc(await Doc.fromXml(source), [], { layout: 'full' });
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

/** A many-valued property as it is: reading it does not create it (a validator reads the live document before a change). */
function raw(el: El, prop: string): El[] {
  const v = (el as unknown as Record<string, unknown>)[prop];
  return Array.isArray(v) ? (v as El[]) : [];
}

const idOf = (el: El): string => String(el.get<string | undefined>('id') ?? '');

/**
 * A host validator that reads the parsed document (validateDoc): every node
 * needs an incoming and an outgoing sequence flow (start, boundary and end
 * events excepted; the lint warns about the same, so these errors cover
 * W_UNREACHABLE / W_DEAD_END), a process has at most one start event (an
 * error on each when it has several), and more than `limit` tasks is a
 * warning without an element whose key keeps it the same finding while its
 * message changes with the count.
 */
function gate(limit = 9): NamedValidator {
  return {
    name: 'gate',
    detail: 'the test host',
    covers: { E_GATE_UNREACHABLE: 'W_UNREACHABLE', E_GATE_DEAD_END: 'W_DEAD_END' },
    validateDoc: (doc) => {
      const out: ValidatorFinding[] = [];
      for (const p of doc.processes()) {
        const elements = raw(p, 'flowElements');
        const nodes = elements.filter((e) => is(e, 'bpmn:FlowNode'));
        const flows = elements.filter((e) => is(e, 'bpmn:SequenceFlow'));
        const sources = new Set(flows.map((f) => f.get<El>('sourceRef')));
        const targets = new Set(flows.map((f) => f.get<El>('targetRef')));
        const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
        if (starts.length > 1) for (const s of starts) out.push({ severity: 'error', code: 'E_GATE_START_EVENTS', message: `${idOf(s)} is one of ${starts.length} start events`, element: idOf(s) });
        for (const n of nodes) {
          if (!is(n, 'bpmn:StartEvent') && !is(n, 'bpmn:BoundaryEvent') && !targets.has(n)) out.push({ severity: 'error', code: 'E_GATE_UNREACHABLE', message: `${idOf(n)} has no incoming sequence flow`, element: idOf(n) });
          if (!is(n, 'bpmn:EndEvent') && !sources.has(n)) out.push({ severity: 'error', code: 'E_GATE_DEAD_END', message: `${idOf(n)} has no outgoing sequence flow`, element: idOf(n) });
        }
        const tasks = nodes.filter((n) => is(n, 'bpmn:Task')).length;
        if (tasks > limit) out.push({ severity: 'warning', code: 'W_GATE_SIZE', message: `process ${idOf(p)} has ${tasks} tasks, more than ${limit}`, key: `size:${idOf(p)}` });
      }
      return out;
    },
  };
}

/** A host validator that reads the XML: every task and sequence flow needs a shape or an edge. */
const shapes = (text: string): ValidatorFinding[] =>
  [...text.matchAll(/<bpmn:(task|sequenceFlow) id="([^"]+)"/g)]
    .filter((m) => !text.includes(`bpmnElement="${m[2]}"`))
    .map((m) => ({ severity: 'error', code: 'E_NOT_DRAWN', message: `${m[1]} ${m[2]} has no shape or edge`, element: m[2] }));

const LOOSE: Op[] = [{ op: 'add', kind: 'task', name: 'Loose', in: 'P' }];

describe('host validators on mutations (MutationOptions.validators)', () => {
  it('refuses a change that introduces a validator error; the same change passes without the validator', async () => {
    const file = await drawn('line.bpmn', LINE);
    const r = await refusal(file, LOOSE, { validators: [gate()] });
    expect(r.code).toBe('E_VALIDATION');
    expect(codes(r.errors)).toEqual(['[gate] E_GATE_UNREACHABLE Activity_Loose', '[gate] E_GATE_DEAD_END Activity_Loose']);
    expect(r.errors[0]).toMatchObject({ validator: 'gate', severity: 'error' });
    const plain = await mutateFile(file, LOOSE, { dryRun: true });
    expect(plain.validation.validators).toBeUndefined();
    expect(codes(plain.validation.warnings)).toEqual(expect.arrayContaining(['W_UNREACHABLE Activity_Loose', 'W_DEAD_END Activity_Loose']));
  });

  it('--force writes it and reports the errors with the validator', async () => {
    const file = await drawn('forced.bpmn', LINE);
    const result = await mutateFile(file, LOOSE, { validators: [gate()], force: true });
    expect(result.written).toBe(true);
    expect(codes(result.validation.errors)).toEqual(['[gate] E_GATE_UNREACHABLE Activity_Loose', '[gate] E_GATE_DEAD_END Activity_Loose']);
    expect(result.validation.validators).toEqual([expect.objectContaining({ name: 'gate', detail: 'the test host', counts: { errors: 2, warnings: 0 }, preexisting: [], resolved: [] })]);
    // the lint warnings about the same node are not repeated next to the errors that cover them
    expect(codes(result.validation.warnings)).not.toContain('W_DEAD_END Activity_Loose');
    expect(codes(result.validation.warnings)).not.toContain('W_UNREACHABLE Activity_Loose');
  });

  it('an error the file already had does not block an edit; it is reported as W_PREEXISTING_ERROR and follows a rename', async () => {
    const file = await drawn('dead-end.bpmn', DEAD_END);
    const renamed = await mutateFile(file, [{ op: 'set', id: 'A', values: { id: 'Activity_Check', name: 'Check order' } }], { validators: [gate()] });
    expect(renamed.written).toBe(true);
    const pre = renamed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR' && (w as { validator?: string }).validator === 'gate');
    expect(pre.map((w) => [w.element, w.message])).toEqual([
      ['Activity_Check', 'E_GATE_DEAD_END: Activity_Check has no outgoing sequence flow (already in the model before this change)'],
      ['E', 'E_GATE_UNREACHABLE: E has no incoming sequence flow (already in the model before this change)'],
    ]);
    expect(renamed.validation.validators?.[0]).toMatchObject({ errors: [], preexisting: [expect.objectContaining({ code: 'E_GATE_DEAD_END' }), expect.objectContaining({ code: 'E_GATE_UNREACHABLE' })] });
    // fixing them resolves them
    const fixed = await mutateFile(file, [{ op: 'connect', source: 'Activity_Check', target: 'E' }], { validators: [gate()] });
    expect(fixed.validation.validators?.[0]).toMatchObject({
      errors: [],
      preexisting: [],
      resolved: [expect.objectContaining({ code: 'E_GATE_DEAD_END', element: 'Activity_Check' }), expect.objectContaining({ code: 'E_GATE_UNREACHABLE', element: 'E' })],
      counts: { errors: 0, warnings: 0 },
    });
  });

  it('a second start event is refused even with its path; a node and its flows in one transaction pass', async () => {
    const file = await drawn('starts.bpmn', LINE);
    const second = await refusal(file, [{ op: 'add', kind: 'startEvent', name: 'Retry', in: 'P' }, { op: 'connect', source: 'Event_Retry', target: 'A' }], { validators: [gate()] });
    expect(codes(second.errors)).toEqual(['[gate] E_GATE_START_EVENTS S', '[gate] E_GATE_START_EVENTS Event_Retry']);
    const alone = await refusal(file, [{ op: 'add', kind: 'task', name: 'Parallel', in: 'P' }], { validators: [gate()] });
    expect(alone.errors).toHaveLength(2);
    const batch = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Parallel', in: 'P' }, { op: 'connect', source: 'A', target: 'Activity_Parallel' }, { op: 'connect', source: 'Activity_Parallel', target: 'E' }], { validators: [gate()], dryRun: true });
    expect(batch.validation.validators?.[0]?.errors).toEqual([]);
  });

  it('findings are counted one by one: a third start event is refused, removing one of two resolves both findings', async () => {
    const two = xml(`<bpmn:startEvent id="S" /><bpmn:startEvent id="S2" /><bpmn:task id="A" name="Check" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F0" sourceRef="S2" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E" />`);
    const file = await drawn('two-starts.bpmn', two);
    const third = await refusal(file, [{ op: 'add', kind: 'startEvent', name: 'Third', in: 'P' }, { op: 'connect', source: 'Event_Third', target: 'A' }], { validators: [gate()] });
    expect(codes(third.errors)).toEqual(['[gate] E_GATE_START_EVENTS Event_Third']);
    const removed = await mutateFile(file, [{ op: 'remove', ids: ['S2'] }], { validators: [gate()], dryRun: true });
    expect(removed.validation.validators?.[0]).toMatchObject({ errors: [], resolved: [expect.objectContaining({ element: 'S' }), expect.objectContaining({ element: 'S2' })] });
  });

  it('warnings a change introduces are reported once; later writes only count them (a key keeps a finding whose message changes)', async () => {
    const file = await drawn('complex.bpmn', LINE);
    const ops: Op[] = Array.from({ length: 9 }, (_, i) => ({ op: 'add', kind: 'task', name: `Step ${i}`, after: i === 0 ? 'A' : `Activity_Step${i - 1}` }));
    const grown = await mutateFile(file, ops, { validators: [gate()] });
    expect(codes(grown.validation.warnings).filter((c) => c.includes('GATE'))).toEqual(['[gate] W_GATE_SIZE']);
    const again = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'One more', after: 'Activity_Step8' }], { validators: [gate()] });
    expect(codes(again.validation.warnings).filter((c) => c.includes('GATE'))).toEqual([]);
    expect(again.validation.validators?.[0]?.counts).toEqual({ errors: 0, warnings: 1 });
  });

  it('never changes what is written: the same edit gives the same bytes with and without a validator that reads the document', async () => {
    const lanes = await drawn(
      'bytes.bpmn',
      xml(`<bpmn:laneSet id="LS"><bpmn:lane id="L1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
<bpmn:startEvent id="S" /><bpmn:businessRuleTask id="A" name="Check" calledDecision="d" /><bpmn:endEvent id="E" />
<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" /><bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="E" />`),
    );
    for (const ops of [[{ op: 'set', id: 'A', values: { name: 'Checked' } }], [{ op: 'add', kind: 'task', name: 'Next', after: 'A' }]] as Op[][]) {
      const without = await mutateFile(lanes, ops, { dryRun: true });
      const withValidator = await mutateFile(lanes, ops, { dryRun: true, validators: [gate()] });
      expect(withValidator.xml).toBe(without.xml);
    }
  });

  it('checks what would be written: without the layout a new node has no shape', async () => {
    const file = await drawn('no-layout.bpmn', LINE);
    const r = await refusal(file, [{ op: 'add', kind: 'task', name: 'Inserted', after: 'A' }], { validators: [shapes], layout: false });
    // the new flow's id in the file's style (src/idstyle.ts): LINE numbers its flows F1, F2 (the prefix), the body names the ends
    expect(codes(r.errors)).toEqual(['[shapes] E_NOT_DRAWN Activity_Inserted', '[shapes] E_NOT_DRAWN F_InsertedToE']);
    expect((await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Inserted', after: 'A' }], { validators: [shapes], dryRun: true })).validation.validators?.[0]?.errors).toEqual([]);
  });

  /** ERROR / WARN, ruleId, a message naming the element, no element field */
  const unnamedTasks = (xml: string): ValidatorFinding[] =>
    [...xml.matchAll(/<bpmn:task id="([^"]+)"(?![^>]*name=)/g)].map((m) => ({ severity: 'ERROR', ruleId: 'naming/task', message: `task ${m[1]} has no name` }));

  it('ruleId findings: an introduced ERROR blocks, a pre-existing one (matched by message, renames followed) does not', async () => {
    const file = await drawn('host.bpmn', LINE);
    const r = await refusal(file, [{ op: 'add', kind: 'task', after: 'A' }], { validators: [unnamedTasks] });
    // an unnamed task gets its placement as id (Activity_After<anchor>, src/idstyle.ts)
    expect(r.errors).toEqual([{ code: 'naming/task', message: 'task Activity_AfterCheck has no name', validator: 'unnamedTasks', severity: 'error' }]);

    const unnamed = await drawn('host-unnamed.bpmn', LINE.replace(' name="Check"', ''));
    const renamed = await mutateFile(unnamed, [{ op: 'set', id: 'A', values: { id: 'Activity_Old' } }], { validators: [{ name: 'naming', validate: unnamedTasks }] });
    expect(renamed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR')).toEqual([
      { code: 'W_PREEXISTING_ERROR', message: 'naming/task: task Activity_Old has no name (already in the model before this change)', validator: 'naming', severity: 'warning' },
    ]);
    expect(renamed.validation.validators).toEqual([{ name: 'naming', errors: [], warnings: [], preexisting: [expect.objectContaining({ code: 'naming/task' })], resolved: [], counts: { errors: 1, warnings: 0 } }]);
  });

  it('runs before and after with a context; the candidate is the laid-out XML; async validators work', async () => {
    const file = await drawn('ctx.bpmn', LINE);
    const seen: Array<{ phase: string; file?: string; platform: string; ops: number; shape: boolean; doc: boolean }> = [];
    const spy = async (x: string, ctx: ValidatorContext): Promise<ValidatorFinding[]> => {
      const doc = await ctx.doc();
      seen.push({ phase: ctx.phase, file: ctx.file, platform: ctx.platform, ops: ctx.ops.length, shape: x.includes('bpmnElement="Activity_New"'), doc: !!doc.get('A') });
      return ctx.phase === 'after' ? [{ severity: 'warning', code: 'W_HOST', message: 'checked', element: 'Activity_New' }] : [];
    };
    const result = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'New', after: 'A' }], { validators: [spy] });
    expect(seen).toEqual([
      { phase: 'before', file, platform: 'none', ops: 1, shape: false, doc: true },
      { phase: 'after', file, platform: 'none', ops: 1, shape: true, doc: true },
    ]);
    expect(result.validation.warnings.at(-1)).toEqual({ code: 'W_HOST', message: 'checked', element: 'Activity_New', validator: 'spy', severity: 'warning' });
  });

  it('a validator that throws fails the write (E_VALIDATOR_FAILED); a bad validator is refused', async () => {
    const file = await drawn('throws.bpmn', LINE);
    const r = await refusal(file, [{ op: 'set', id: 'A', values: { name: 'X' } }], { validators: [{ name: 'broken', validate: () => { throw new Error('boom'); } }] });
    expect(r.code).toBe('E_VALIDATOR_FAILED');
    const notArray = await refusal(file, [{ op: 'set', id: 'A', values: { name: 'X' } }], { validators: [{ name: 'odd', validate: () => 'nope' as unknown as ValidatorFinding[] }] });
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

  it('in-memory documents (no file) run the host validators', async () => {
    const doc = await Doc.fromXml(LINE);
    let phases = 0;
    const result = await mutateDoc(doc, [{ op: 'set', id: 'A', values: { name: 'Y' } }], { validators: [() => (phases++, [])] });
    expect(phases).toBe(2);
    expect(result.validation.validators?.map((r) => r.name)).toEqual(['validator1']);
  });
});

describe('validator findings in a refusal, a result and their text (library use)', () => {
  it('the refusal lists each finding with its validator; the report line, a forced write and the pre-existing count', async () => {
    const file = await drawn('text.bpmn', LINE);
    const before = readFileSync(file, 'utf8');
    const err = await mutateFile(file, LOOSE, { validators: [gate()] }).then(
      () => undefined,
      (e: unknown) => e as CliError,
    );
    expect(err?.code).toBe('E_VALIDATION');
    expect(err?.message).toBe('The change would introduce 2 error(s) reported by validator gate; nothing was written');
    expect(err?.details.hint).not.toContain('--profile');
    // each finding with its validator tag (validatorTag; the CLI's own refusal output is tested below)
    expect((err?.details['errors'] as Warning[]).map((e) => `${validatorTag(e)}${e.code} ${e.element}: ${e.message}`)).toEqual([
      '[gate] E_GATE_UNREACHABLE Activity_Loose: Activity_Loose has no incoming sequence flow',
      '[gate] E_GATE_DEAD_END Activity_Loose: Activity_Loose has no outgoing sequence flow',
    ]);
    expect(JSON.parse(JSON.stringify(err?.toJSON())).errors[0]).toMatchObject({ code: 'E_GATE_UNREACHABLE', validator: 'gate', severity: 'error' });
    expect(readFileSync(file, 'utf8')).toBe(before);

    const inserted = await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Review', after: 'A' }], { validators: [gate()] });
    expect(renderMutation(mutationReport(inserted))).toContain('validator gate (the test host): 0 error(s), 0 warning(s) in the result');
    const forced = await mutateFile(file, LOOSE, { validators: [gate()], force: true });
    expect(renderMutation(mutationReport(forced))).toContain('forced [gate] E_GATE_UNREACHABLE Activity_Loose');
    // the error the file already had does not block; a result counts it instead of repeating it
    const pre = mutationReport(await mutateFile(file, [{ op: 'set', id: 'Activity_Loose', values: { name: 'Still loose' } }], { validators: [gate()] }));
    expect(pre.warnings).toMatchObject({ added: [], preexistingCount: expect.any(Number) });
    expect(pre.warnings.preexistingCount).toBeGreaterThan(0);
    expect(renderMutation(pre)).not.toContain('W_PREEXISTING_ERROR');
    expect(renderMutation(pre)).toMatch(/^\d+ warnings? already in the file \(not repeated/m);
  });
});

describe('host validators on validate (CheckOptions.validators)', () => {
  it('every finding is reported with its validator, errors fail the check, a covered lint warning is dropped', async () => {
    const file = await drawn('check.bpmn', DEAD_END);
    const plain = await checkFile(file);
    expect(plain.validation.errors).toEqual([]);
    expect(plain.validation.warnings.map((w) => w.code)).toContain('W_DEAD_END');
    expect(plain.validation.validators).toBeUndefined();

    const check = await checkFile(file, { validators: [gate()] });
    expect(check.validation.errors.map((e) => [e.code, e.element, (e as { validator?: string }).validator])).toEqual([
      ['E_GATE_DEAD_END', 'A', 'gate'],
      ['E_GATE_UNREACHABLE', 'E', 'gate'],
    ]);
    expect(check.validation.warnings.map((w) => w.code)).not.toContain('W_DEAD_END');
    expect(check.validation.validators).toEqual([expect.objectContaining({ name: 'gate', detail: 'the test host', counts: { errors: 2, warnings: 0 } })]);
    expect(check.layout.status).toBe('ok');

    // `bpmn validate`'s report and text for it; validateXml gives the same report
    const report = validationReport(check);
    expect(report.ok).toBe(false);
    expect(report).not.toHaveProperty('profile');
    expect(report.validators?.[0]?.errors[0]).toMatchObject({ code: 'E_GATE_DEAD_END', element: 'A', validator: 'gate', severity: 'error' });
    const text = renderValidation(report);
    expect(text).toContain('[gate] E_GATE_DEAD_END A: A has no outgoing sequence flow');
    expect(text).toContain('validator gate (the test host): 2 error(s), 0 warning(s) in the file');
    expect(await validateXml(readFileSync(file, 'utf8'), { validators: [gate()], file })).toEqual(report);
  });

  it("the validators see the file's own diagram, not the layout dry run", async () => {
    const file = join(dir, 'no-di.bpmn');
    writeFileSync(file, LINE);
    const report = await checkFile(file, { validators: [shapes] });
    expect(report.layout.status).toBe('ok');
    expect(report.validation.errors.map((e) => `${e.code} ${e.element}`)).toEqual(['E_NOT_DRAWN A', 'E_NOT_DRAWN F1', 'E_NOT_DRAWN F2']);
  });
});

describe('the CLI takes no validators', () => {
  it('--profile is an unknown option like any other: usage error, nothing written', async () => {
    const file = await drawn('cli.bpmn', LINE);
    const before = readFileSync(file, 'utf8');
    const profile = cli('add', file, 'task', 'X', '--profile', 'none');
    expect(profile.code).toBe(1);
    expect(profile.err).toContain("error E_USAGE: unknown option '--profile'");
    // exactly what any other unknown option gives
    expect(profile.err.replaceAll('profile', 'bogus')).toBe(cli('add', file, 'task', 'X', '--bogus', 'none').err);
    const validate = cli('validate', file, '--profile', 'design');
    expect(validate.code).toBe(1);
    expect(validate.err).toContain("error E_USAGE: unknown option '--profile'");
    expect(readFileSync(file, 'utf8')).toBe(before);
    const json = JSON.parse(cli('validate', file, '--json').out) as Record<string, unknown>;
    expect(json['ok']).toBe(true);
    expect(json).not.toHaveProperty('profile');
    expect(json).not.toHaveProperty('validators');
  }, 60000);

  it('a structural error: the refusal lists it under the error (exit 2, nothing written), and validate fails with exit 2', async () => {
    const file = await drawn('cli-refusal.bpmn', LINE);
    const ops = join(dir, 'esp.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'subProcess', id: 'Esp2', in: 'P', set: { triggeredByEvent: 'true' } }]));
    const before = readFileSync(file, 'utf8');

    const refused = cli('apply', file, ops);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('error E_VALIDATION: The change would introduce 1 structural error(s); nothing was written\n  E_EVENT_SUBPROCESS_NO_START Esp2: Event sub-process Esp2 has no start event  (');
    expect(refused.err).toMatch(/^ {2}hint: Fix the listed problems, or pass --force/m);
    const refusedJson = cli('apply', file, ops, '--json');
    expect(refusedJson.code).toBe(2);
    expect(JSON.parse(refusedJson.err)).toMatchObject({ ok: false, error: { code: 'E_VALIDATION', errors: [{ code: 'E_EVENT_SUBPROCESS_NO_START', element: 'Esp2' }] } });
    expect(readFileSync(file, 'utf8')).toBe(before);

    // --force writes it; validate then reports the error and fails
    expect(cli('apply', file, ops, '--force').code).toBe(0);
    // --backup is opt-in: a write without it leaves no .bak
    expect(existsSync(`${file}.bak`)).toBe(false);
    const check = cli('validate', file);
    expect(check.code).toBe(2);
    expect(check.out).toMatch(/^E_EVENT_SUBPROCESS_NO_START Esp2: Event sub-process Esp2 has no start event/m);
    expect(check.out).toMatch(/^1 error\(s\), \d+ warning\(s\)$/m);
    const checkJson = cli('validate', file, '--json');
    expect(checkJson.code).toBe(2);
    expect(JSON.parse(checkJson.out)).toMatchObject({ ok: false, errors: [{ code: 'E_EVENT_SUBPROCESS_NO_START', element: 'Esp2' }] });
  }, 60000);
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

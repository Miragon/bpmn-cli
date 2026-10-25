/**
 * The validator hook (src/validate/validators.ts): MutationOptions.validators on
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
import { Doc } from '../src/model/Doc.js';
import { ERROR_CATALOGUE } from '../src/report/guide.js';
import type { CliError, Warning } from '../src/shared/CliError.js';
import { is, type El } from '../src/model/utils/moddle.js';
import type { Op } from '../src/ops/types.js';
import { checkFile, mutateFile } from '../src/node/index.js';
import { mutateDoc, mutationReport, mutationSummary, renderMutation, renderSummary, renderValidation, validationReport } from '../src/index.js';
import type { MutationOptions } from '../src/pipeline/index.js';
import { validatorTag } from '../src/report/utils/findings.js';
import { FindingBaseline } from '../src/validate/FindingBaseline.js';
import { ValidatorSet } from '../src/validate/ValidatorSet.js';
import { validatorRefusal } from '../src/validate/utils/validator-issues.js';
import type { NamedValidator, ValidatorContext, ValidatorFinding, ValidatorRun } from '../src/validate/validators.js';

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
    // the lint warnings the gate's findings say again (covers: W_DEAD_END, W_UNREACHABLE) are resolved once, as those findings
    expect(codes(mutationReport(fixed).warnings.resolved)).toEqual(['[gate] E_GATE_DEAD_END Activity_Check', '[gate] E_GATE_UNREACHABLE E']);
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
    // the new flow's id in the file's style (src/ids/IdStyle.ts): LINE numbers its flows F1, F2 (the prefix), the body names the ends
    expect(codes(r.errors)).toEqual(['[shapes] E_NOT_DRAWN Activity_Inserted', '[shapes] E_NOT_DRAWN F_InsertedToE']);
    expect((await mutateFile(file, [{ op: 'add', kind: 'task', name: 'Inserted', after: 'A' }], { validators: [shapes], dryRun: true })).validation.validators?.[0]?.errors).toEqual([]);
  });

  /** ERROR / WARN, ruleId, a message naming the element, no element field */
  const unnamedTasks = (xml: string): ValidatorFinding[] =>
    [...xml.matchAll(/<bpmn:task id="([^"]+)"(?![^>]*name=)/g)].map((m) => ({ severity: 'ERROR', ruleId: 'naming/task', message: `task ${m[1]} has no name` }));

  it('ruleId findings: an introduced ERROR blocks, a pre-existing one (matched by message, renames followed) does not', async () => {
    const file = await drawn('host.bpmn', LINE);
    const r = await refusal(file, [{ op: 'add', kind: 'task', after: 'A' }], { validators: [unnamedTasks] });
    // an unnamed task gets its placement as id (Activity_After<anchor>, src/ids/IdStyle.ts)
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
    const swapped = FindingBaseline.compareRuns(run(['task A has no name', 'task B has a typo']), run(['task B has no name', 'task A has a typo']), new Map([['A', 'B'], ['B', 'A']]));
    expect(swapped[0]).toMatchObject({ errors: [], resolved: [], preexisting: [expect.objectContaining({ message: 'task B has no name' }), expect.objectContaining({ message: 'task A has a typo' })] });
    // A.B is another id than A: renaming A leaves it alone
    const dotted = FindingBaseline.compareRuns(run(['task A.B has no name']), run(['task A.B has no name']), new Map([['A', 'X']]));
    expect(dotted[0]!.errors).toEqual([]);
  });

  it('an advisory validator (blocks: false) reports the errors a change introduced among the warnings and never blocks; old errors are only counted', async () => {
    const file = await drawn('advisory.bpmn', LINE);
    const advisory = { name: 'advice', blocks: false, validate: unnamedTasks };
    const r = await mutateFile(file, [{ op: 'add', kind: 'task', after: 'A' }], { validators: [advisory], dryRun: true });
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings.at(-1)).toEqual({ code: 'naming/task', message: 'task Activity_AfterCheck has no name', validator: 'advice', severity: 'error' });
    expect(r.validation.validators).toEqual([{ name: 'advice', blocks: false, errors: [], warnings: [expect.objectContaining({ code: 'naming/task' })], preexisting: [], resolved: [], counts: { errors: 1, warnings: 0 } }]);
    // an error the file already had: no W_PREEXISTING_ERROR, only the count
    const unnamed = await drawn('advisory-unnamed.bpmn', LINE.replace(' name="Check"', ''));
    const old = await mutateFile(unnamed, [{ op: 'set', id: 'E', values: { name: 'Done' } }], { validators: [advisory], dryRun: true });
    expect(old.validation.warnings.filter((w) => (w as { validator?: string }).validator === 'advice')).toEqual([]);
    expect(old.validation.validators?.[0]).toMatchObject({ blocks: false, preexisting: [], counts: { errors: 1, warnings: 0 } });
    // the default stays blocking
    await expect(mutateFile(file, [{ op: 'add', kind: 'task', after: 'A' }], { validators: [{ name: 'advice', validate: unnamedTasks }], dryRun: true })).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('two validators of one name compare in order: the second run after with the second run before', () => {
    const issue = (code: string) => ({ code, message: code, validator: 'host', severity: 'warning' as const });
    const before: ValidatorRun[] = [{ name: 'host', issues: [issue('W_ONE')] }, { name: 'host', issues: [issue('W_TWO')] }];
    const after: ValidatorRun[] = [{ name: 'host', issues: [issue('W_ONE')] }, { name: 'host', issues: [issue('W_TWO'), issue('W_THREE')] }];
    const reports = FindingBaseline.compareRuns(before, after);
    expect(reports.map((r) => r.warnings.map((w) => w.code))).toEqual([[], ['W_THREE']]);
    expect(reports.map((r) => r.resolved.length)).toEqual([0, 0]);
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

/** gate(), but a write leaves its dead ends out of the comparison (ValidatorFinding.leftOut); a check reports them. */
function leftOutGate(blocks = true): NamedValidator {
  const g = gate();
  return {
    ...g,
    ...(blocks ? {} : { blocks: false }),
    validateDoc: async (doc, ctx) => (await g.validateDoc!(doc, ctx)).map((f) => (f.code === 'E_GATE_DEAD_END' && ctx.phase !== 'check' ? { ...f, leftOut: 'dead ends the host checks elsewhere' } : f)),
  };
}

describe('findings a write leaves out (ValidatorFinding.leftOut)', () => {
  it('are not compared: never added, kept or resolved, never blocking; counted with their reason, in the text too; their lint warnings stay', async () => {
    const file = await drawn('left-out.bpmn', DEAD_END);
    // the loose task's dead end is left out: only its unreachable start blocks
    const r = await refusal(file, LOOSE, { validators: [leftOutGate()] });
    expect(codes(r.errors)).toEqual(['[gate] E_GATE_UNREACHABLE Activity_Loose']);

    const renamed = await mutateFile(file, [{ op: 'set', id: 'A', values: { name: 'Checked' } }], { validators: [leftOutGate()], dryRun: true });
    const v = renamed.validation.validators![0]!;
    expect(v).toEqual({ name: 'gate', detail: 'the test host', errors: [], warnings: [], preexisting: [expect.objectContaining({ code: 'E_GATE_UNREACHABLE', element: 'E' })], resolved: [], counts: { errors: 2, warnings: 0 }, leftOut: [{ reason: 'dead ends the host checks elsewhere', count: 1 }] });
    // the issues keep their reason hidden: JSON has the report's leftOut only
    expect(JSON.stringify(renamed.validation)).not.toContain('"leftOut":"');
    // `bpmn validate` does not run a host's validators: the host's check lists them
    expect(renderMutation(mutationReport(renamed))).toContain('\nvalidator gate (the test host): 2 error(s), 0 warning(s) in the result (1 left out (dead ends the host checks elsewhere; a check lists it))\n');

    // fixing both: only the compared finding is resolved; the lint warning the left-out one would cover is resolved as itself
    const fixed = mutationReport(await mutateFile(file, [{ op: 'connect', source: 'A', target: 'E' }], { validators: [leftOutGate()], dryRun: true }));
    expect(fixed.validation.validators![0]).toMatchObject({ resolved: [expect.objectContaining({ code: 'E_GATE_UNREACHABLE', element: 'E' })], counts: { errors: 0, warnings: 0 } });
    expect(fixed.validation.validators![0]).not.toHaveProperty('leftOut');
    expect(codes(fixed.warnings.resolved)).toEqual(['W_DEAD_END A', '[gate] E_GATE_UNREACHABLE E']);

    // advisory: the line adds them after the findings the file already had; a new dead end keeps its lint warning
    const advisory = mutationReport(await mutateFile(file, LOOSE, { validators: [leftOutGate(false)], dryRun: true }));
    expect(codes(advisory.warnings.added)).toEqual(['W_DEAD_END Activity_Loose', '[gate] E_GATE_UNREACHABLE Activity_Loose']);
    expect(renderMutation(advisory)).toContain('\nvalidator gate (the test host): 4 error(s), 0 warning(s) in the result (1 added, 0 resolved, 1 already in the file, 2 left out (dead ends the host checks elsewhere; a check lists them))\n');
    // the summary counts what the file already had among the warnings, and names what was left out in a line of its own
    const summary = mutationSummary(advisory);
    expect(summary.warnings.preexistingCount).toBe(advisory.warnings.preexistingCount + 1);
    expect(summary.leftOut).toEqual([{ validator: 'gate', reason: 'dead ends the host checks elsewhere', count: 2 }]);
    expect(renderSummary(summary, { dryRun: true }).split('\n')).toContain('validator gate: 2 left out (dead ends the host checks elsewhere; a check lists them)');
    expect(mutationSummary(fixed)).not.toHaveProperty('leftOut');

    // a check reports them like any other finding (and they cover their lint warning)
    const check = await checkFile(file, { validators: [leftOutGate()] });
    expect(codes(check.validation.errors)).toEqual(['[gate] E_GATE_DEAD_END A', '[gate] E_GATE_UNREACHABLE E']);
    expect(check.validation.warnings.map((w) => w.code)).not.toContain('W_DEAD_END');
    expect(check.validation.validators![0]).not.toHaveProperty('leftOut');
  });

  it('one entry per reason, in the order of the findings; errors and warnings alike', async () => {
    const host = (_xml: string, ctx: ValidatorContext): ValidatorFinding[] => {
      const left = (reason: string) => (ctx.phase === 'check' ? {} : { leftOut: reason });
      return [
        { severity: 'error', code: 'E_ONE', message: 'one', ...left('the first reason') },
        { severity: 'warning', code: 'W_TWO', message: 'two', ...left('the second reason') },
        { severity: 'warning', code: 'W_THREE', message: 'three', ...left('the first reason') },
      ];
    };
    const r = await mutateDoc(await Doc.fromXml(LINE), [{ op: 'set', id: 'A', values: { name: 'Y' } }], { validators: [{ name: 'host', blocks: false, validate: host }] });
    expect(r.validation.validators).toEqual([{ name: 'host', blocks: false, errors: [], warnings: [], preexisting: [], resolved: [], counts: { errors: 1, warnings: 2 }, leftOut: [{ reason: 'the first reason', count: 2 }, { reason: 'the second reason', count: 1 }] }]);
    expect(renderMutation(mutationReport(r))).toContain('\nvalidator host: 1 error(s), 2 warning(s) in the result (0 added, 0 resolved, 0 already in the file, 2 left out (the first reason; a check lists them), 1 left out (the second reason; a check lists it))\n');
    expect(renderSummary(mutationSummary(mutationReport(r))).split('\n')).toContain('validator host: 2 left out (the first reason; a check lists them), 1 left out (the second reason; a check lists it)');
  });

  it('a finding the file had that is still in the result, now left out, is not resolved; one left out before and real after is added', async () => {
    const doc = await Doc.fromXml(LINE);
    const reason = 'the host checks it elsewhere';
    // `A` is real before and left out after, `B` the reverse, `C` real in both
    const host = (_xml: string, ctx: ValidatorContext): ValidatorFinding[] => [
      { severity: 'error', code: 'E_HOST', message: 'about A', element: 'A', ...(ctx.phase === 'after' ? { leftOut: reason } : {}) },
      { severity: 'error', code: 'E_HOST', message: 'about B', element: 'B', ...(ctx.phase === 'before' ? { leftOut: reason } : {}) },
      { severity: 'error', code: 'E_HOST', message: 'about C', element: 'C' },
    ];
    const runs = (phase: 'before' | 'after') => new ValidatorSet([{ name: 'host', blocks: false, validate: host }]).run({ xml: async () => '', doc: async () => doc }, { phase, platform: 'none', ops: [] });
    const [report] = FindingBaseline.compareRuns(await runs('before'), await runs('after'));
    // A is still in the result: not resolved; B is news; added (B) + kept (C) + left out (A) = counts
    expect(report).toEqual({ name: 'host', blocks: false, errors: [], warnings: [expect.objectContaining({ element: 'B' })], preexisting: [], resolved: [], counts: { errors: 3, warnings: 0 }, leftOut: [{ reason, count: 1 }] });
    expect(renderMutation(mutationReport(await mutateDoc(doc, [], { validators: [{ name: 'host', blocks: false, validate: host }] })))).toContain('\nvalidator host: 3 error(s), 0 warning(s) in the result (1 added, 0 resolved, 1 already in the file, 1 left out (the host checks it elsewhere; a check lists it))\n');
  });

  it('a run with no run before (an advisory validator of a created document) reports every finding, left-out ones too', async () => {
    const host = (_xml: string, ctx: ValidatorContext): ValidatorFinding[] => [{ severity: 'warning', code: 'W_HOST', message: 'not linted', ...(ctx.phase === 'check' ? {} : { leftOut: 'no rule ran' }) }];
    const created = await mutateDoc(Doc.create({ processName: 'Order' }), [], { validators: [{ name: 'host', blocks: false, validate: host }] });
    expect(created.validation.validators).toEqual([{ name: 'host', blocks: false, errors: [], warnings: [expect.objectContaining({ code: 'W_HOST' })], preexisting: [], resolved: [], counts: { errors: 0, warnings: 1 } }]);
    // a blocking one has its run before: the finding is left out
    const blocking = await mutateDoc(Doc.create({ processName: 'Order' }), [], { validators: [{ name: 'host', validate: host }] });
    expect(blocking.validation.validators![0]).toMatchObject({ warnings: [], leftOut: [{ reason: 'no rule ran', count: 1 }] });
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
    expect(refused.err).toMatch(/^ {2}hint: Fix the listed problems, make the edit in one transaction \(`bpmn apply <file> ops.json`\) so that it ends in a valid model, or pass --force/m);
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

/** The sentences of a text that name `bpmn validate` without saying that it does not show the refused errors. */
const sendsToValidate = (text: string): string[] => text.split(/(?<=\.)\s+/).filter((s) => s.includes('bpmn validate') && !s.includes('does not show'));

describe('the E_VALIDATION advice: the refusal lists the errors, `bpmn validate` cannot', () => {
  const HINT = 'Fix the listed problems, make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway.';

  it('a structural refusal: its errors are under it, the file is unchanged and validate shows none of them; the hint is the validator refusal\'s', () => {
    const file = join(dir, 'black-box.bpmn');
    expect(cli('new', file).code).toBe(0);
    expect(cli('add', file, 'task', 'Check invoice').code).toBe(0);
    const before = readFileSync(file, 'utf8');

    const refused = cli('add', file, 'participant', 'Customer', '--black-box');
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/^error E_VALIDATION: The change would introduce 2 structural error\(s\); nothing was written$/m);
    expect(refused.err).toMatch(/^ {2}E_EMPTY_COLLABORATION /m);
    expect(refused.err).toMatch(/^ {2}E_ORPHAN_PROCESS /m);
    expect(refused.err).toContain(`\n  hint: ${HINT}\n`);
    const json = JSON.parse(cli('add', file, 'participant', 'Customer', '--black-box', '--json').err) as { error: Record<string, unknown> };
    expect(json.error).toMatchObject({ code: 'E_VALIDATION', hint: HINT, errors: [{ code: 'E_EMPTY_COLLABORATION' }, { code: 'E_ORPHAN_PROCESS' }] });
    expect(readFileSync(file, 'utf8')).toBe(before);

    // where the old advice sent the reader: the unchanged file is valid, and none of the refused errors shows
    const check = cli('validate', file);
    expect(check.code).toBe(0);
    expect(check.out).toMatch(/^valid, \d+ warning\(s\)$/m);
    expect(check.out).not.toMatch(/E_EMPTY_COLLABORATION|E_ORPHAN_PROCESS/);

    // the same advice as a validator's refusal, without its brackets
    const byValidator = validatorRefusal([{ code: 'DEAD_END', message: 'A has no outgoing flow', element: 'A', validator: 'house-rules', severity: 'error' }]);
    expect(byValidator.details.hint?.replace(' (each names its validator in brackets)', '')).toBe(HINT);
    expect(sendsToValidate(`${byValidator.details.hint}`)).toEqual([]);
  }, 60000);

  it('the catalogue (guide, kinds, kinds --json), the short guide and the plugin skill do not send the reader to `bpmn validate`', () => {
    const entry = ERROR_CATALOGUE.find((e) => e.code === 'E_VALIDATION');
    expect(entry?.fix).toMatch(/^Read the errors in the refusal: /);
    expect(entry?.fix).toContain('The file is unchanged, so `bpmn validate <file>` does not show them.');
    expect(sendsToValidate(entry?.fix ?? '')).toEqual([]);
    expect(cli('guide', 'errors').out).toContain(`      fix: ${entry?.fix}\n`);
    // the error output the fix points to: the guide's own JSON shape has `errors`
    const commands = cli('guide', 'commands').out;
    expect(commands).toContain('an E_VALIDATION refusal lists\n  each error it would add on a line under the message');
    expect(commands).toMatch(/\{ok: false, error: \{code, message,\n {2}element\?, related\?, candidates\?, hint\?, op\?, command\?, ops\?, errors\?\}\}/);

    const short = cli('guide', '--short').out;
    const line = short.split('\n').find((l) => /^ {2}E_VALIDATION /.test(l)) ?? '';
    expect(line).toMatch(/the refusal lists the new errors \(file unchanged\)/);
    expect(line).not.toContain('bpmn validate');
    expect(Buffer.byteLength(short)).toBeLessThanOrEqual(5120);

    const skill = readFileSync(join(ROOT, 'plugins', 'bpmn-cli', 'skills', 'bpmn', 'SKILL.md'), 'utf8');
    const row = skill.split('\n').find((l) => l.startsWith('| `E_VALIDATION` |')) ?? '';
    expect(row).toContain('The refusal lists each one');
    expect(sendsToValidate(row)).toEqual([]);
  }, 60000);
});

function cli(...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

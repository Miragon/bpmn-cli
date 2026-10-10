/**
 * Step 2 integration: the four packages of the design-iq round (the
 * browser-safe core with its in-memory API, the text-preserving writes, the
 * file's id conventions, the validators and the design profile) work as one
 * pipeline:
 *
 *  - the in-memory API runs the text-preserving step: a no-op is `unchanged`
 *    (the input string itself), an edit changes only what it touched;
 *  - new ids and DI ids follow the file and survive that step; a full redraw
 *    keeps every DI start tag; a sticky that follows its node keeps its text;
 *  - validators see exactly what is written (after the text-preserving step),
 *    in memory too: the design profile with a host's content repository;
 *  - the node layer finds the content repository of the file it writes and
 *    tells the validators that file (also with `out`).
 *
 * Fixtures are synthetic (test/fixtures/roundtrip/styled.bpmn and inline).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, layoutXml, validateXml, type CliError, type ValidatorContext, type ValidatorFinding } from '../src/index.js';
import { checkFile, mutateFile } from '../src/node/files.js';

const ROOT = join(import.meta.dirname, '..');
const STYLED = readFileSync(join(ROOT, 'test', 'fixtures', 'roundtrip', 'styled.bpmn'), 'utf8');

/** The lines of `a` that `b` no longer has (as a multiset), in order. */
function removedLines(a: string, b: string): string[] {
  const left = new Map<string, number>();
  for (const l of b.split('\n')) left.set(l, (left.get(l) ?? 0) + 1);
  return a.split('\n').filter((l) => {
    const n = left.get(l) ?? 0;
    if (!n) return true;
    left.set(l, n - 1);
    return false;
  });
}

/** The process part of a file (everything before the diagram). */
const semantic = (xml: string): string => xml.split('<bpmndi:BPMNDiagram')[0]!;

/** The start tags of every DI element, in order. */
const diTags = (xml: string): string[] => [...xml.matchAll(/<bpmndi:(?:BPMNShape|BPMNEdge|BPMNPlane|BPMNDiagram) [^>]*>/g)].map((m) => m[0]);

async function rejected(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (err) {
    return err as CliError;
  }
  throw new Error('expected a rejection');
}

/** A design model: start -> call activity -> end, drawn (the design profile wants every node in the diagram). */
async function designModel(called: string): Promise<string> {
  const drawn = await applyToXml(
    `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Order" isExecutable="false" />
</bpmn:definitions>
`,
    [
      { op: 'add', kind: 'startEvent', id: 'Start', name: 'Order in' },
      { op: 'add', kind: 'callActivity', id: 'Call_Billing', name: 'Bill', after: 'Start', set: { calledElement: called } },
      { op: 'add', kind: 'endEvent', id: 'End', name: 'Done', after: 'Call_Billing' },
    ],
    { profile: 'none' },
  );
  return drawn.xml;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bpmn-step2-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the in-memory API keeps the text (core + roundtrip + conventions)', () => {
  it('a no-op is unchanged: the input string itself', async () => {
    const r = await applyToXml(STYLED, [{ op: 'set', id: 'Task_Check', values: { name: 'Check order' } }]);
    expect(r.unchanged).toBe(true);
    expect(r.xml).toBe(STYLED);
    expect(r.result.unchanged).toBe(true);
  });

  it("an insert gets ids in the file's style and changes only the lines it touched", async () => {
    const r = await applyToXml(STYLED, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }]);
    expect(r.unchanged).toBe(false);
    // Task_ + PascalCase like Task_Check / Task_Script; the file numbers its flows (Flow_1, Flow_2, Flow_4): a new one
    // keeps the prefix and names its ends
    expect(r.result.created.map((c) => c.id)).toEqual(['Task_AuditOrder', 'Flow_AuditOrderToOrderOk']);
    // in the process only the spliced flow's target changed (its incoming entry moved to the new task); comments, CDATA and quoting stay
    expect(removedLines(semantic(STYLED), semantic(r.xml)).map((l) => l.trim())).toEqual(['<bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Check" targetRef="Gateway_Ok"/>']);
    expect(r.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Order ok?" default="Flow_No">\n            <bpmn:incoming>Flow_AuditOrderToOrderOk</bpmn:incoming>');
    expect(r.xml.startsWith(STYLED.split('<bpmn:process')[0]!)).toBe(true);
    expect(r.xml).toContain('<bpmn:userTask id="Task_AuditOrder" name="Audit order">\n            <bpmn:incoming>Flow_2</bpmn:incoming>');
    expect(r.xml).toContain('<bpmn:sequenceFlow id="Flow_AuditOrderToOrderOk" sourceRef="Task_AuditOrder" targetRef="Gateway_Ok"/>');
    // new DI in the file's DI id style (<id>_di), the old DI keeps its start tags
    expect(r.xml).toContain('<bpmndi:BPMNShape id="Task_AuditOrder_di" bpmnElement="Task_AuditOrder">');
    expect(r.xml).toContain('<bpmndi:BPMNEdge id="Flow_AuditOrderToOrderOk_di" bpmnElement="Flow_AuditOrderToOrderOk">');
    expect(diTags(r.xml).filter((t) => !/Task_AuditOrder|Flow_AuditOrderToOrderOk/.test(t))).toEqual(diTags(STYLED));
    expect(r.xml.endsWith('<!-- end of the synthetic fixture -->\n</bpmn:definitions>')).toBe(true);
  });

  it('a full redraw (layoutXml) keeps every DI start tag and the process text byte for byte', async () => {
    const r = await layoutXml(STYLED);
    expect(r.result.layout.mode).toBe('full');
    expect(diTags(r.xml)).toEqual(diTags(STYLED));
    expect(semantic(r.xml)).toBe(semantic(STYLED));
  });

  it('a design-iq sticky follows its node and keeps its own text apart from the new position', async () => {
    const withSticky = STYLED.replace('<bpmn:definitions ', '<bpmn:definitions xmlns:bpmiq="https://bpmiq.io/schema/1.0/bpmiq" ').replace(
      /(<bpmn:process id="Process_Styled"[^>]*>\n)/,
      '$1        <bpmn:extensionElements>\n            <bpmiq:sticky id="Sticky_1" text="Who packs?" x="510" y="180" width="80" height="40"/>\n        </bpmn:extensionElements>\n',
    );
    const r = await applyToXml(withSticky, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }]);
    expect(r.result.layout.stickies).toEqual([{ sticky: 'Sticky_1', node: 'Task_Script' }]);
    // Task_Script moved 152 px right; the sticky by the same shift, nothing else of its line changed
    expect(r.xml).toContain('\n            <bpmiq:sticky id="Sticky_1" text="Who packs?" x="662" y="180" width="80" height="40"/>\n');
    expect((await applyToXml(withSticky, [{ op: 'set', id: 'Task_Check', values: { name: 'Check order' } }])).unchanged).toBe(true);
  });
});

describe('validators see what is written (validation + core + roundtrip)', () => {
  it('a host validator gets the text-preserving result as its candidate, in memory', async () => {
    const seen: Array<{ phase: string; file?: string; comment: boolean; cdata: boolean }> = [];
    const spy = (xml: string, ctx: ValidatorContext): ValidatorFinding[] => {
      seen.push({ phase: ctx.phase, file: ctx.file, comment: xml.includes('<!-- the order starts here -->'), cdata: xml.includes('<![CDATA[var total') });
      return ctx.phase === 'after' && xml.includes('Task_AuditOrder') ? [{ severity: 'WARN', ruleId: 'audit/seen', message: 'audit step added' }] : [];
    };
    const r = await applyToXml(STYLED, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }], { validators: [spy], file: 'models/order.bpmn' });
    expect(seen).toEqual([
      { phase: 'before', file: 'models/order.bpmn', comment: true, cdata: true },
      { phase: 'after', file: 'models/order.bpmn', comment: true, cdata: true },
    ]);
    expect(r.result.validation.validators).toMatchObject([{ name: 'spy', warnings: [{ code: 'audit/seen', validator: 'spy' }] }]);
    expect(renderLines(r.result.validation.warnings)).toContain('[spy] audit/seen');
  });

  it('the design profile in memory: auto runs it for a content repository the host names, with its link checks', async () => {
    const xml = await designModel('billing');
    // without a repository, auto runs no profile (in memory there is no bpmiq.yml to find)
    expect((await validateXml(xml)).profile).toEqual({ profile: 'none', source: 'none', detail: expect.any(String) });
    const repo = { processIds: ['payments'], decisionIds: [] };
    const report = await validateXml(xml, { contentRepo: repo, file: 'order.bpmn' });
    expect(report.profile).toMatchObject({ profile: 'design', source: 'content-repo' });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => `${w.code} ${w.element}`)).toEqual(['W_DESIGN_CALL_LINK Call_Billing']);
    expect((await validateXml(xml, { contentRepo: { processIds: ['billing'] } })).warnings).toEqual([]);

    // a write that leaves a node unconnected is refused by the design gate, a connected one passes
    const err = await rejected(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }], { contentRepo: repo }));
    expect(err.code).toBe('E_VALIDATION');
    expect((err.details['errors'] as Array<{ code: string; validator?: string }>).map((e) => `${e.validator} ${e.code}`)).toEqual(['design E_DESIGN_UNREACHABLE', 'design E_DESIGN_DEAD_END']);
    const ok = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Check', after: 'Start' }], { contentRepo: repo });
    expect(ok.result.validation.validators?.[0]).toMatchObject({ name: 'design', errors: [], counts: { errors: 0 } });
    expect(await rejected(applyToXml(xml, [], { profile: 'strict' as never }))).toMatchObject({ code: 'E_USAGE' });
  });
});

/** The text lines of findings (`[validator] CODE`), for a quick look. */
function renderLines(findings: Array<{ code: string; validator?: string }>): string[] {
  return findings.map((f) => `${f.validator ? `[${f.validator}] ` : ''}${f.code}`);
}

describe('the node layer finds the content repository of the file it writes (validation + core)', () => {
  it('auto: a model of a bpmiq.yml repository gets the design gate; the validators see the target of --out', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'models'), { recursive: true });
    writeFileSync(join(repo, 'bpmiq.yml'), 'models: models\n');
    writeFileSync(join(repo, 'models', 'payments.bpmn'), await designModel('billing'));
    const model = join(repo, 'models', 'order.bpmn');
    writeFileSync(model, await designModel('payments'));
    const outside = join(dir, 'order.bpmn');
    writeFileSync(outside, await designModel('payments'));

    const loose = [{ op: 'add' as const, kind: 'task', name: 'Loose', in: 'Process_Order' }];
    expect(await rejected(mutateFile(model, loose, { dryRun: true }))).toMatchObject({ code: 'E_VALIDATION' });
    expect((await mutateFile(outside, loose, { dryRun: true })).validation.validators).toBeUndefined();
    expect((await mutateFile(model, loose, { dryRun: true, profile: 'none' })).validation.validators).toBeUndefined();

    // the call link resolves against the repository's models (payments.bpmn), so the file is clean
    const check = await checkFile(model);
    expect(check.profile).toMatchObject({ profile: 'design', source: 'content-repo' });
    expect(check.validation.warnings.filter((w) => w.code.startsWith('W_DESIGN'))).toEqual([]);

    // with --out the validators are told the file being written, and the repository is the target's
    const files: Array<string | undefined> = [];
    const target = join(repo, 'models', 'copy.bpmn');
    const r = await mutateFile(outside, [{ op: 'set', id: 'Call_Billing', values: { name: 'Bill the order' } }], { out: target, validators: [(_xml, ctx) => (files.push(ctx.file), [])] });
    expect(files).toEqual([target, target]);
    expect(r.validation.validators?.[0]).toMatchObject({ name: 'design', errors: [] });
    expect(r.written).toBe(true);
  });

  it('`bpmn validate --profile design --json` and validateXml report the same', async () => {
    const xml = await designModel('billing');
    const file = join(dir, 'same.bpmn');
    writeFileSync(file, xml);
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'validate', file, '--profile', 'design', '--json'], { encoding: 'utf8', cwd: ROOT });
    expect(run.status, run.stderr).toBe(0);
    const { file: _file, ...cli } = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(await validateXml(xml, { profile: 'design', file })).toEqual(cli);
    expect(cli['profile']).toEqual({ profile: 'design', source: 'option', detail: '--profile design' });
  });
});

/**
 * Step 2 integration: the four packages of the design-iq round (the
 * browser-safe core with its in-memory API, the text-preserving writes, the
 * file's id conventions and the validator hook) work as one pipeline:
 *
 *  - the in-memory API runs the text-preserving step: a no-op is `unchanged`
 *    (the input string itself), an edit changes only what it touched;
 *  - new ids and DI ids follow the file and survive that step; a full redraw
 *    keeps every DI start tag; a sticky that follows its node keeps its text;
 *  - validators see exactly what is written (after the text-preserving step),
 *    in memory too: a host validator refuses a write that introduces its error;
 *  - the node layer tells the validators the file it writes (also with `out`)
 *    or checks.
 *
 * Fixtures are synthetic (test/fixtures/roundtrip/styled.bpmn and inline).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyToXml, layoutXml, validateXml, type CliError, type ValidatorContext, type ValidatorFinding } from '../src/index.js';
import { checkFile, mutateFile } from '../src/node.js';

const ROOT = join(import.meta.dirname, '..');
const STYLED = readFileSync(join(ROOT, 'test', 'fixtures', 'roundtrip', 'styled.bpmn'), 'utf8');

/** The lines of `a` that `b` no longer has (as a multiset), in order. */
function removedLines(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const line of after.split('\n')) left.set(line, (left.get(line) ?? 0) + 1);
  return before.split('\n').filter((line) => {
    const count = left.get(line) ?? 0;
    if (!count) return true;
    left.set(line, count - 1);
    return false;
  });
}

/** The process part of a file (everything before the diagram). */
const semantic = (xml: string): string => xml.split('<bpmndi:BPMNDiagram')[0]!;

/** The start tags of every DI element, in order. */
const diTags = (xml: string): string[] => [...xml.matchAll(/<bpmndi:(?:BPMNShape|BPMNEdge|BPMNPlane|BPMNDiagram) [^>]*>/g)].map((match) => match[0]);

async function rejected(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (err) {
    return err as CliError;
  }
  throw new Error('expected a rejection');
}

/** A model without engine namespace: start -> call activity -> end, drawn. */
async function orderModel(called: string): Promise<string> {
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
    const result = await applyToXml(STYLED, [{ op: 'set', id: 'Task_Check', values: { name: 'Check order' } }]);
    expect(result.unchanged).toBe(true);
    expect(result.xml).toBe(STYLED);
    expect(result.result.unchanged).toBe(true);
  });

  it("an insert gets ids in the file's style and changes only the lines it touched", async () => {
    const result = await applyToXml(STYLED, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }]);
    expect(result.unchanged).toBe(false);
    // Task_ + PascalCase like Task_Check / Task_Script; the file numbers its flows (Flow_1, Flow_2, Flow_4): a new one
    // keeps the prefix and names its ends
    expect(result.result.created.map((change) => change.id)).toEqual(['Task_AuditOrder', 'Flow_AuditOrderToOrderOk']);
    // in the process only the spliced flow's target changed (its incoming entry moved to the new task); comments, CDATA and quoting stay
    expect(removedLines(semantic(STYLED), semantic(result.xml)).map((line) => line.trim())).toEqual(['<bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Check" targetRef="Gateway_Ok"/>']);
    expect(result.xml).toContain('<bpmn:exclusiveGateway id="Gateway_Ok" name="Order ok?" default="Flow_No">\n            <bpmn:incoming>Flow_AuditOrderToOrderOk</bpmn:incoming>');
    expect(result.xml.startsWith(STYLED.split('<bpmn:process')[0]!)).toBe(true);
    expect(result.xml).toContain('<bpmn:userTask id="Task_AuditOrder" name="Audit order">\n            <bpmn:incoming>Flow_2</bpmn:incoming>');
    expect(result.xml).toContain('<bpmn:sequenceFlow id="Flow_AuditOrderToOrderOk" sourceRef="Task_AuditOrder" targetRef="Gateway_Ok"/>');
    // new DI in the file's DI id style (<id>_di), the old DI keeps its start tags
    expect(result.xml).toContain('<bpmndi:BPMNShape id="Task_AuditOrder_di" bpmnElement="Task_AuditOrder">');
    expect(result.xml).toContain('<bpmndi:BPMNEdge id="Flow_AuditOrderToOrderOk_di" bpmnElement="Flow_AuditOrderToOrderOk">');
    expect(diTags(result.xml).filter((tag) => !/Task_AuditOrder|Flow_AuditOrderToOrderOk/.test(tag))).toEqual(diTags(STYLED));
    expect(result.xml.endsWith('<!-- end of the synthetic fixture -->\n</bpmn:definitions>')).toBe(true);
  });

  it('a full redraw (layoutXml) keeps every DI start tag and the process text byte for byte', async () => {
    const result = await layoutXml(STYLED);
    expect(result.result.layout.mode).toBe('full');
    expect(diTags(result.xml)).toEqual(diTags(STYLED));
    expect(semantic(result.xml)).toBe(semantic(STYLED));
  });

  it('a design-iq sticky follows its node and keeps its own text apart from the new position', async () => {
    const withSticky = STYLED.replace('<bpmn:definitions ', '<bpmn:definitions xmlns:bpmiq="https://bpmiq.io/schema/1.0/bpmiq" ').replace(
      /(<bpmn:process id="Process_Styled"[^>]*>\n)/,
      '$1        <bpmn:extensionElements>\n            <bpmiq:sticky id="Sticky_1" text="Who packs?" x="510" y="180" width="80" height="40"/>\n        </bpmn:extensionElements>\n',
    );
    const result = await applyToXml(withSticky, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }]);
    expect(result.result.layout.stickies).toEqual([{ sticky: 'Sticky_1', node: 'Task_Script' }]);
    // Task_Script moved 149 px right (the space tool pushes only by the room that is missing); the sticky by the same shift, nothing else of its line changed
    expect(result.xml).toContain('\n            <bpmiq:sticky id="Sticky_1" text="Who packs?" x="659" y="180" width="80" height="40"/>\n');
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
    const result = await applyToXml(STYLED, [{ op: 'add', kind: 'userTask', name: 'Audit order', after: 'Task_Check' }], { validators: [spy], file: 'models/order.bpmn' });
    expect(seen).toEqual([
      { phase: 'before', file: 'models/order.bpmn', comment: true, cdata: true },
      { phase: 'after', file: 'models/order.bpmn', comment: true, cdata: true },
    ]);
    expect(result.result.validation.validators).toMatchObject([{ name: 'spy', warnings: [{ code: 'audit/seen', validator: 'spy' }] }]);
    expect(renderLines(result.result.warnings.added)).toContain('[spy] audit/seen');
  });

  it('a host validator in memory: a write that introduces its error is refused, validateXml reports every finding', async () => {
    const xml = await orderModel('billing');
    /** a call activity calls a process the host knows (a warning); every task is reached by a sequence flow (an error) */
    const host = (text: string): ValidatorFinding[] => [
      ...[...text.matchAll(/<bpmn:callActivity id="([^"]+)"[^>]*calledElement="([^"]+)"/g)]
        .filter((match) => match[2] !== 'payments')
        .map((match) => ({ severity: 'WARN', ruleId: 'refs/dangling', message: `${match[1]} calls ${match[2]}, which the host does not know`, element: match[1] })),
      ...[...text.matchAll(/<bpmn:task id="([^"]+)"/g)].filter((match) => !text.includes(`targetRef="${match[1]}"`)).map((match) => ({ severity: 'ERROR', ruleId: 'flow/unreachable', message: `${match[1]} is never reached`, element: match[1] })),
    ];
    expect((await validateXml(xml)).validators).toBeUndefined();
    const report = await validateXml(xml, { validators: [host], file: 'order.bpmn' });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((warning) => `${warning.code} ${warning.element}`)).toEqual(['refs/dangling Call_Billing']);
    expect((await validateXml(await orderModel('payments'), { validators: [host] })).warnings).toEqual([]);

    // a write that leaves a node unconnected is refused by the host validator, a connected one passes
    const err = await rejected(applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Loose', in: 'Process_Order' }], { validators: [host] }));
    expect(err.code).toBe('E_VALIDATION');
    expect((err.details['errors'] as Array<{ code: string; validator?: string }>).map((error) => `${error.validator} ${error.code}`)).toEqual(['host flow/unreachable']);
    const ok = await applyToXml(xml, [{ op: 'add', kind: 'task', name: 'Check', after: 'Start' }], { validators: [host] });
    expect(ok.result.validation.validators?.[0]).toMatchObject({ name: 'host', errors: [], counts: { errors: 0, warnings: 1 } });
  });
});

/** The text lines of findings (`[validator] CODE`), for a quick look. */
function renderLines(findings: Array<{ code: string; validator?: string }>): string[] {
  return findings.map((finding) => `${finding.validator ? `[${finding.validator}] ` : ''}${finding.code}`);
}

describe('the node layer tells the validators the file (validation + core)', () => {
  it('the validators see the file written (the target of --out) or checked, unless `file` names another', async () => {
    const source = join(dir, 'order.bpmn');
    writeFileSync(source, await orderModel('payments'));
    const files: Array<string | undefined> = [];
    const seen = (_xml: string, ctx: ValidatorContext): ValidatorFinding[] => (files.push(ctx.file), []);
    const target = join(dir, 'models', 'copy.bpmn');
    const result = await mutateFile(source, [{ op: 'set', id: 'Call_Billing', values: { name: 'Bill the order' } }], { out: target, validators: [seen] });
    expect(files).toEqual([target, target]);
    expect(result.validation.validators).toMatchObject([{ name: 'seen', errors: [] }]);
    expect(result.written).toBe(true);
    expect(result.file).toBe(target);

    files.length = 0;
    await mutateFile(source, [{ op: 'set', id: 'Call_Billing', values: { name: 'Bill' } }], { dryRun: true, validators: [seen] });
    await checkFile(source, { validators: [seen] });
    await mutateFile(source, [{ op: 'set', id: 'Call_Billing', values: { name: 'Bill' } }], { dryRun: true, file: 'models/order.bpmn', validators: [seen] });
    expect(files).toEqual([source, source, source, 'models/order.bpmn', 'models/order.bpmn']);
  });

  it('`bpmn validate --json` and validateXml report the same', async () => {
    const xml = await orderModel('billing');
    const file = join(dir, 'same.bpmn');
    writeFileSync(file, xml);
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'validate', file, '--json'], { encoding: 'utf8', cwd: ROOT });
    expect(run.status, run.stderr).toBe(0);
    const { file: _file, ...cli } = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(await validateXml(xml, { file })).toEqual(cli);
    expect(cli).not.toHaveProperty('profile');
  });
});

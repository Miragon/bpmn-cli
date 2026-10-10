/**
 * End-to-end: builds the CLI once and drives it through a realistic session.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'dist', 'cli.js');
let dir: string;
let file: string;

interface Run {
  code: number;
  out: string;
  err: string;
  json: () => any;
}

function bpmn(...args: string[]): Run {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: dir, input: '' });
  return {
    code: r.status ?? -1,
    out: r.stdout,
    err: r.stderr,
    json: () => JSON.parse(r.stdout || r.stderr),
  };
}

function ok(...args: string[]): Run {
  const r = bpmn(...args);
  if (r.code !== 0) throw new Error(`bpmn ${args.join(' ')} failed (${r.code}):\n${r.err}\n${r.out}`);
  return r;
}

async function reparse(): Promise<Doc> {
  const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
  expect(doc.importWarnings).toHaveLength(0);
  return doc;
}

function diIds(xml: string): string[] {
  return [...xml.matchAll(/bpmnElement="([^"]+)"/g)].map((m) => m[1]!);
}

beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.json')], { cwd: ROOT, stdio: 'inherit' });
  // the second step of `npm run build` (type shims), so dist stays what the build makes
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build-types.mjs')], { cwd: ROOT, stdio: 'inherit' });
  dir = mkdtempSync(join(tmpdir(), 'bpmn-cli-'));
  file = join(dir, 'order.bpmn');
}, 60000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bpmn cli session', () => {
  it('creates a file with one process', async () => {
    const r = ok('new', file, '--name', 'Order handling', '--target', 'camunda8');
    expect(r.out).toMatch(/Process_OrderHandling/);
    expect(r.out).toMatch(/written: /);
    const xml = readFileSync(file, 'utf8');
    expect(xml).toContain('xmlns:zeebe');
    expect(xml).toContain('bpmndi:BPMNDiagram');
    await reparse();
    expect(bpmn('new', file).code).toBe(4);
  });

  it('builds a process with the placement grammar', async () => {
    ok('add', file, 'startEvent', 'Order received');
    ok('add', file, 'userTask', 'Check invoice', '--after', 'Event_OrderReceived');
    ok('add', file, 'xor', 'Invoice ok?', '--after', 'Activity_CheckInvoice');
    let r = ok('add', file, 'serviceTask', 'Book invoice', '--after', 'Gateway_InvoiceOk', '--flow-name', 'yes', '--condition', '${ok}');
    expect(r.out).toMatch(/appended after Gateway_InvoiceOk/);
    ok('add', file, 'endEvent', 'Invoice booked', '--after', 'Activity_BookInvoice');
    r = ok('add', file, 'userTask', 'Clarify invoice', '--after', 'Gateway_InvoiceOk', '--flow-name', 'no', '--default', '--to', 'Activity_CheckInvoice');
    expect(r.out).toMatch(/Activity_ClarifyInvoice -> Activity_CheckInvoice/);
    r = ok('add', file, 'boundaryEvent:timer', '2 days', '--on', 'Activity_CheckInvoice', '--timer', 'PT2D', '--non-interrupting');
    expect(r.out).toMatch(/attached to Activity_CheckInvoice/);
    ok('add', file, 'sendTask', 'Remind clerk', '--after', 'Event_2Days');
    const doc = await reparse();
    const gw = doc.get('Gateway_InvoiceOk')!;
    expect(doc.outgoing(gw)).toHaveLength(2);
    expect(gw.get<any>('default').get('name')).toBe('no');
    const yes = doc.outgoing(gw).find((f) => f.get('name') === 'yes')!;
    expect(yes.get<any>('conditionExpression').body).toBe('${ok}');
    const be = doc.get('Event_2Days')!;
    expect(be.get('cancelActivity')).toBe(false);
    expect(be.get<any>('eventDefinitions')[0].timeDuration.body).toBe('PT2D');
    const xml = readFileSync(file, 'utf8');
    for (const id of ['Event_OrderReceived', 'Activity_CheckInvoice', 'Gateway_InvoiceOk', 'Activity_BookInvoice', 'Event_InvoiceBooked', 'Activity_ClarifyInvoice', 'Event_2Days', 'Activity_RemindClerk']) {
      expect(diIds(xml)).toContain(id);
    }
  });

  it('shows the model without coordinates', () => {
    const r = ok('show', file);
    expect(r.out).toMatch(/process Process_OrderHandling/);
    expect(r.out).toMatch(/userTask Activity_CheckInvoice "Check invoice"/);
    expect(r.out).toMatch(/exclusiveGateway Gateway_InvoiceOk/);
    expect(r.out).toMatch(/boundaryEvent:timer Event_2Days/);
    expect(r.out).not.toMatch(/x=|Bounds|waypoint/);
    const j = ok('show', file, '--json').json();
    expect(j.processes[0].nodes.map((n: any) => n.id)).toContain('Activity_CheckInvoice');
    const d = ok('show', file, 'Gateway_InvoiceOk', '--json').json();
    expect(d.kind).toBe('exclusiveGateway');
    expect(d.outgoing).toHaveLength(2);
    const f = ok('find', file, 'invoice', '--json').json();
    expect(f.length).toBeGreaterThan(2);
  });

  it('validates, sets properties and manages extensions', async () => {
    let r = ok('validate', file);
    expect(r.out).toMatch(/layout: ok/);
    ok('set', file, 'Activity_CheckInvoice', 'name=Check the invoice', 'zeebe:modelerTemplate=check-form', 'doc=Compare with purchase order');
    ok('ext', 'add', file, 'Activity_BookInvoice', 'zeebe:taskDefinition', 'type=book-invoice', 'retries=3');
    r = ok('ext', 'list', file, 'Activity_BookInvoice');
    expect(r.out).toMatch(/zeebe:taskDefinition/);
    const doc = await reparse();
    const t = doc.get('Activity_CheckInvoice')!;
    expect(t.get('name')).toBe('Check the invoice');
    expect(t.$attrs['zeebe:modelerTemplate']).toBe('check-form');
    expect(t.get<any>('documentation')[0].text).toBe('Compare with purchase order');
    const xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/<zeebe:taskDefinition type="book-invoice" retries="3"/);
    r = ok('set', file, 'Activity_BookInvoice', 'loop=parallel', 'cardinality=3');
    const doc2 = await reparse();
    expect(doc2.get('Activity_BookInvoice')!.get<any>('loopCharacteristics').$type).toBe('bpmn:MultiInstanceLoopCharacteristics');
  });

  it('retypes, removes with bridging and reorders', async () => {
    ok('retype', file, 'Activity_BookInvoice', 'userTask');
    let doc = await reparse();
    expect(doc.get('Activity_BookInvoice')!.$type).toBe('bpmn:UserTask');
    expect(doc.incoming(doc.get('Activity_BookInvoice')!)).toHaveLength(1);
    const r = ok('remove', file, 'Activity_BookInvoice');
    expect(r.out).toMatch(/bridged/);
    doc = await reparse();
    expect(doc.get('Activity_BookInvoice')).toBeUndefined();
    const yes = doc.outgoing(doc.get('Gateway_InvoiceOk')!).find((f) => f.get('name') === 'yes')!;
    expect(yes.get<any>('targetRef').id).toBe('Event_InvoiceBooked');
    const flows = doc.outgoing(doc.get('Gateway_InvoiceOk')!).map((f) => f.get<string>('id'));
    ok('order', file, 'Gateway_InvoiceOk', flows[1]!, flows[0]!);
    doc = await reparse();
    expect(doc.outgoing(doc.get('Gateway_InvoiceOk')!).map((f) => f.get('id'))).toEqual([flows[1], flows[0]]);
  });

  it('applies a JSON batch with a split macro', async () => {
    const ops = {
      ops: [
        { op: 'add', kind: 'subProcess', name: 'Payment', after: 'Gateway_InvoiceOk', before: 'Event_InvoiceBooked' },
        { op: 'add', kind: 'startEvent', name: 'Pay start', in: 'Activity_Payment' },
        { op: 'add', kind: 'serviceTask', name: 'Charge card', after: 'Event_PayStart' },
        { op: 'add', kind: 'endEvent', name: 'Paid', after: 'Activity_ChargeCard' },
        {
          op: 'split',
          after: 'Activity_ChargeCard',
          kind: 'exclusiveGateway',
          name: 'Charged?',
          branches: [
            { flowName: 'yes', condition: '${charged}', nodes: [] },
            { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Retry manually' }] },
          ],
        },
        { op: 'add', kind: 'dataObject', name: 'Invoice', in: 'Process_OrderHandling' },
        { op: 'connect', source: 'Activity_CheckInvoice', target: 'DataObjectReference_Invoice' },
        // an unnamed element gets a hashed id: give it one to refer to it later in the batch
        { op: 'add', kind: 'textAnnotation', id: 'TextAnnotation_Fallback', text: 'Manual fallback', in: 'Activity_Payment' },
        { op: 'connect', source: 'TextAnnotation_Fallback', target: 'Activity_RetryManually' },
      ],
    };
    const opsFile = join(dir, 'ops.json');
    writeFileSync(opsFile, JSON.stringify(ops));
    const r = ok('apply', file, opsFile, '--json');
    const j = r.json();
    expect(j.ok).toBe(true);
    expect(j.created.map((c: any) => c.id)).toEqual(expect.arrayContaining(['Activity_Payment', 'Gateway_Charged', 'Activity_RetryManually', 'DataObjectReference_Invoice']));
    const doc = await reparse();
    const sub = doc.get('Activity_Payment')!;
    expect(doc.flowNodes(sub).length).toBeGreaterThanOrEqual(5);
    const xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/bpmnElement="Activity_Payment" isExpanded="true"/);
    expect(diIds(xml)).toContain('Activity_RetryManually');
    expect(diIds(xml)).toContain('DataObjectReference_Invoice');
    expect(diIds(xml)).toContain('TextAnnotation_Fallback');
    const v = ok('validate', file, '--json').json();
    expect(v.ok).toBe(true);
  });

  it('collapses and re-expands sub-processes through layout', async () => {
    ok('layout', file, '--collapse', 'Activity_Payment');
    let xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/BPMNPlane_Activity_Payment/);
    expect(xml).not.toMatch(/bpmnElement="Activity_Payment" isExpanded="true"/);
    ok('add', file, 'task', 'Unrelated', '--in', 'Process_OrderHandling');
    xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/BPMNPlane_Activity_Payment/);
    ok('set', file, 'Activity_Payment', 'expanded=true');
    xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/bpmnElement="Activity_Payment" isExpanded="true"/);
  });

  it('adds pools and message flows', async () => {
    ok('add', file, 'participant', 'Shop');
    ok('add', file, 'participant', 'Customer', '--black-box');
    const r = ok('connect', file, 'Activity_CheckInvoice', 'Participant_Customer', '--name', 'Clarification request');
    expect(r.out).toMatch(/messageFlow/);
    const doc = await reparse();
    expect(doc.collaboration()).toBeDefined();
    expect(doc.participants()).toHaveLength(2);
    expect(doc.messageFlows()).toHaveLength(1);
    const xml = readFileSync(file, 'utf8');
    expect(diIds(xml)).toContain('Participant_Shop');
    expect(diIds(xml)).toContain('Participant_Customer');
  });

  it('reports errors with codes and exit codes', () => {
    let r = bpmn('add', file, 'userTask', 'X', '--after', 'Nope');
    expect(r.code, r.err).toBe(2);
    expect(r.err).toMatch(/error E_NOT_FOUND/);
    r = bpmn('add', file, 'complexGateway', 'X');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/error E_UNSUPPORTED_KIND/);
    r = bpmn('show', join(dir, 'missing.bpmn'));
    expect(r.code).toBe(4);
    r = bpmn('add', file, 'userTask', 'X', '--after', 'Nope', '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).error.code).toBe('E_NOT_FOUND');
    r = bpmn('add', file, 'userTask', 'Y', '--after', 'Gateway_InvoiceOk', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/dry run/);
    r = bpmn('show', file, 'Activity_Y');
    expect(r.code).toBe(2);
  });

  it('prints self-description', () => {
    const k = ok('kinds', '--json').json();
    expect(k.kinds.map((x: any) => x.kind)).toContain('userTask');
    expect(ok('guide').out).toMatch(/apply/);
    expect(ok('kinds').out).toMatch(/boundaryEvent/);
  });
});

/**
 * Contracts an agent relies on: documented error formats and exit codes, the
 * same validation on the CLI as in `apply`, and options that are never lost.
 */
describe('bpmn cli contracts', () => {
  let f: string;

  beforeAll(() => {
    f = join(dir, 'contracts.bpmn');
    ok('new', f, '--id', 'P');
    ok('add', f, 'start', 'S');
    ok('add', f, 'subProcess', 'Sub', '--after', 'Event_S');
    ok('add', f, 'start', 'Inner', '--in', 'Activity_Sub');
  });

  it('reports a missing ops file as an I/O error', () => {
    let r = bpmn('apply', f, join(dir, 'missing.json'));
    expect(r.code).toBe(4);
    expect(r.err).toMatch(/^error E_FILE_NOT_FOUND: Cannot read ops file/);
    r = bpmn('apply', f, join(dir, 'missing.json'), '--json');
    expect(r.code).toBe(4);
    expect(JSON.parse(r.err).error.code).toBe('E_FILE_NOT_FOUND');
    r = bpmn('apply', f, dir);
    expect(r.code).toBe(4);
    expect(r.err).toMatch(/^error E_IO/);
  });

  it('renders commander parse errors in the documented format', () => {
    let r = bpmn('show', f, '--frob', '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error).toMatchObject({ code: 'E_USAGE', message: expect.stringMatching(/unknown option '--frob'/) });
    r = bpmn('add', f);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error E_USAGE: missing required argument 'kind'/);
    r = bpmn('frobnicate');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error E_USAGE: unknown command 'frobnicate'/);
    expect(r.err).toMatch(/bpmn guide/);
    r = bpmn('find', f, 'x', '--kind', 'frob', '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.code).toBe('E_UNKNOWN_KIND');
    expect(bpmn('--help').code).toBe(0);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(bpmn('--version').out.trim()).toBe(pkg.version);
    r = bpmn('layout', '--help');
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/--no-layout/);
  });

  it('validates and reports layout --expand / --collapse', () => {
    let r = ok('layout', f, '--expand', 'Activity_Sub');
    expect(r.out).toMatch(/changed subProcess Activity_Sub "Sub" - expanded=true/);
    r = bpmn('layout', f, '--collapse', 'Event_S');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/error E_WRONG_KIND/);
    r = bpmn('layout', f, '--expand', 'Activity_Su', '--json');
    expect(r.code).toBe(2);
    const e = JSON.parse(r.err).error;
    expect(e.code).toBe('E_NOT_FOUND');
    expect(e.candidates).toEqual(['Activity_Sub']);
    expect(bpmn('layout', f, '--no-layout').code).toBe(1);
    expect(bpmn('layout', f, '--expand', 'Activity_Sub', '--collapse', 'Activity_Sub').code).toBe(1);
    r = ok('layout', f, '--collapse', 'Activity_Sub', '--json');
    expect(r.json().changed).toEqual([{ id: 'Activity_Sub', kind: 'subProcess', name: 'Sub', detail: 'expanded=false' }]);
    expect(r.json().layout.expanded).toEqual([]);
    ok('layout', f, '--expand', 'Activity_Sub');
  });

  it('keeps collapse requests made with --no-layout', () => {
    let r = ok('set', f, 'Activity_Sub', 'expanded=false', '--no-layout');
    expect(r.out).toMatch(/expanded=false/);
    expect(readFileSync(f, 'utf8')).toMatch(/bpmnElement="Activity_Sub" isExpanded="false"/);
    expect(ok('show', f, 'Activity_Sub').out).toMatch(/expanded: false/);
    ok('layout', f);
    let xml = readFileSync(f, 'utf8');
    expect(xml).toMatch(/BPMNPlane_Activity_Sub/);
    expect(xml).not.toMatch(/bpmnElement="Activity_Sub" isExpanded="true"/);
    r = ok('add', f, 'subProcess', 'Other', '--after', 'Activity_Sub', '--collapsed', '--no-layout');
    expect(r.out).toMatch(/laid out collapsed/);
    ok('layout', f);
    xml = readFileSync(f, 'utf8');
    expect(xml).toMatch(/BPMNPlane_Activity_Other/);
    expect(xml).not.toMatch(/bpmnElement="Activity_Other" isExpanded="true"/);
    ok('layout', f, '--expand', 'Activity_Sub,Activity_Other');
    expect(readFileSync(f, 'utf8')).toMatch(/bpmnElement="Activity_Other" isExpanded="true"/);
  });

  it('re-attaches boundary events with move --on', async () => {
    const g = join(dir, 'move.bpmn');
    ok('new', g, '--id', 'M');
    ok('add', g, 'task', 'A', '--in', 'M');
    ok('add', g, 'task', 'B', '--in', 'M');
    ok('add', g, 'boundary:timer', 'T', '--on', 'Activity_A', '--timer', 'PT1H');
    const r = ok('move', g, 'Event_T', '--on', 'Activity_B');
    expect(r.out).toMatch(/moved onto Activity_B \(was Activity_A\)/);
    const doc = await Doc.fromXml(readFileSync(g, 'utf8'));
    expect(doc.get('Event_T')!.get<any>('attachedToRef').id).toBe('Activity_B');
    expect(bpmn('move', g, 'Event_T').err).toMatch(/--on/);
    expect(bpmn('move', g, 'Event_T', '--on', 'Activity_A', '--in', 'M').err).toMatch(/E_USAGE: --in and --on cannot be combined/);
  });

  it('applies the ops JSON rules to CLI flags', () => {
    const before = readFileSync(f, 'utf8');
    let r = bpmn('add', f, 'task', 'FN', '--in', 'P', '--flow-name', 'x', '--condition', '${c}');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/error E_USAGE: --flow-name, --condition describe the flow into the node and need --after, --before or --flow/);
    r = bpmn('add', f, 'task', 'Dup', '--if-absent');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--if-absent needs an explicit --id/);
    r = bpmn('add', f, 'task', 'X', '--after', 'Event_S', '--condition', '${c}', '--default');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--default and --condition are mutually exclusive/);
    r = bpmn('connect', f, 'Event_S', 'Activity_Sub', '--condition', '${c}', '--default');
    expect(r.code).toBe(1);
    r = bpmn('add', f, 'task', 'X', '--after', 'Event_S', '--in', 'P');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--after and --in cannot be combined/);
    expect(readFileSync(f, 'utf8')).toBe(before);
  });

  it('does not expose diagram interchange ids', () => {
    let r = bpmn('show', f, 'BPMNShape_Event_S');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/error E_NOT_FOUND/);
    expect(r.err).not.toMatch(/candidates:.*BPMNShape/);
    r = bpmn('show', f, 'Event_');
    expect(r.err).toMatch(/candidates: Event_Inner, Event_S$/m);
    expect(bpmn('remove', f, 'BPMNPlane_P').code).toBe(2);
  });

  it('does not write a result that equals the file, and says so', () => {
    const before = readFileSync(f, 'utf8');
    let r = ok('set', f, 'Event_S', 'name=S');
    expect(r.out).toMatch(/^unchanged: .*contracts\.bpmn \(the result equals the file; nothing written\)$/m);
    expect(r.out).not.toMatch(/^written: /m);
    r = ok('set', f, 'Event_S', 'name=S', '--json');
    expect(r.json()).toMatchObject({ ok: true, written: false, unchanged: true });
    r = ok('set', f, 'Event_S', 'name=S', '--dry-run');
    expect(r.out).toMatch(/^dry run: .* not written \(unchanged\)$/m);
    expect(readFileSync(f, 'utf8')).toBe(before);
    r = ok('set', f, 'Event_S', 'name=Started', '--json');
    expect(r.json()).toMatchObject({ written: true, unchanged: false });
  });
});


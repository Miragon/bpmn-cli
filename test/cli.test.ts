/**
 * End-to-end: builds the CLI once and drives it through a realistic session.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../src/model/Doc.js';

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
  return bpmnWith({}, ...args);
}

/** bpmn with these environment variables on top of the test's (test/setup.ts cleared the shell's BPMN_KEEP_FLOW_IDS). */
function bpmnWith(env: Record<string, string>, ...args: string[]): Run {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: dir, input: '', env: { ...process.env, ...env } });
  return {
    code: r.status ?? -1,
    out: r.stdout,
    err: r.stderr,
    json: () => JSON.parse(r.stdout || r.stderr),
  };
}

function ok(...args: string[]): Run {
  return okWith({}, ...args);
}

function okWith(env: Record<string, string>, ...args: string[]): Run {
  const r = bpmnWith(env, ...args);
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
    r = bpmn('add', file, 'choreographyTask', 'X');
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

describe('complex gateways (#74)', () => {
  it('are modelled in a plain file; the Camunda 7 / 8 profiles report them', () => {
    const f = join(dir, 'complex.bpmn');
    ok('new', f, '--id', 'P');
    ok('add', f, 'start', 'S');
    expect(ok('add', f, 'complex', 'Enough reviews?', '--after', 'Event_S').out).toMatch(/created complexGateway Gateway_EnoughReviews/);
    ok('add', f, 'task', 'Legal', '--after', 'Gateway_EnoughReviews');
    ok('add', f, 'task', 'Finance', '--after', 'Gateway_EnoughReviews');
    ok('add', f, 'parallelGateway', '--after', 'Activity_Legal', '--id', 'Join');
    ok('connect', f, 'Activity_Finance', 'Join');
    ok('add', f, 'end', 'Done', '--after', 'Join');
    ok('retype', f, 'Join', 'complexGateway');
    expect(ok('retype', f, 'Gateway_EnoughReviews', 'inclusiveGateway').out).toMatch(/changed inclusiveGateway Gateway_EnoughReviews/);
    ok('retype', f, 'Gateway_EnoughReviews', 'complex');
    expect(ok('validate', f).out).toMatch(/valid, 0 warning/);
    expect(ok('layout', f).code).toBe(0);
    expect(ok('render', f, '-o', join(dir, 'complex.svg')).out).toMatch(/wrote/);
    expect(bpmn('validate', f, '--platform', 'c7').out).toMatch(/W_C7_DEPLOY_COMPLEX_GATEWAY Gateway_EnoughReviews/);
    expect(bpmn('validate', f, '--platform', 'c8').out).toMatch(/W_C8_DEPLOY_UNSUPPORTED Join/);
    expect(bpmn('remove', f, 'Join').err).toMatch(/E_AMBIGUOUS_BRIDGE: Join is a complex join/);
    expect(ok('remove', f, 'Join', '--bridge-all').out).toMatch(/note: Join synchronised Activity_Legal, Activity_Finance/);
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

  it('renames a flow after its new ends without cutting an id that fits into 64 characters (#31)', () => {
    const g = join(dir, 'sync.bpmn');
    ok('new', g, '--name', 'Sync');
    ok('add', g, 'start', 'Every minute');
    ok('add', g, 'serviceTask', 'Consignations synchronisieren', '--after', 'Event_EveryMinute');
    ok('add', g, 'end', 'Consignations aktualisiert', '--after', 'Activity_ConsignationsSynchronisieren');
    const r = ok('add', g, 'serviceTask', 'Consignations protokollieren', '--after', 'Activity_ConsignationsSynchronisieren');
    expect(r.out).toMatch(
      /^changed sequenceFlow Flow_ConsignationsSynchronisierenToConsignationsProtokollieren - .* \(renamed from Flow_ConsignationsSynchronisierenToConsignationsAktualisiert: its id named its old ends\)$/m,
    );
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

  // a pipe is non-blocking once anything touched process.stdin: a synchronous read failed with EAGAIN
  it.skipIf(process.platform === 'win32')('reads a model from a pipe whose writer is slower than the start or pauses (no EAGAIN)', () => {
    const piped = (script: string) => spawnSync('/bin/sh', ['-c', script, 'sh', f, process.execPath, BIN], { encoding: 'utf8', cwd: dir });
    let r = piped('(sleep 0.5; cat "$1") | "$2" "$3" validate - --json --no-lint-config');
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, file: '-' });
    r = piped('(head -c 200 "$1"; sleep 0.5; tail -c +201 "$1") | "$2" "$3" show -');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Activity_Sub');
    r = piped('(sleep 0.5; echo \'[{"op":"set","id":"Event_S","values":{"name":"Started late"}}]\') | "$2" "$3" apply "$1" - --dry-run --json');
    expect(r.status, r.stderr).toBe(0);
  });

  it('a write to a directory (-o) is E_IO and leaves no temp file', () => {
    const target = join(dir, 'adir.bpmn');
    mkdirSync(target);
    const r = bpmn('add', f, 'task', 'X', '--after', 'Event_S', '-o', target);
    expect(r.code).toBe(4);
    expect(r.err).toMatch(/^error E_IO: Cannot write .*adir\.bpmn: it is a directory\n/);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('flow ids kept (--keep-flow-ids, BPMN_KEEP_FLOW_IDS)', () => {
  let base: string;
  const splice = ['serviceTask', 'Book invoice', '--after', 'Activity_CheckInvoice'];
  const STALE = 'warning W_FLOW_ID_STALE Flow_CheckInvoiceToInvoiceDone: Flow Flow_CheckInvoiceToInvoiceDone kept its id, which names its old ends Activity_CheckInvoice -> Event_InvoiceDone; it now runs Activity_CheckInvoice -> Activity_BookInvoice  (Code and tests that use the id keep working; to rename it together with them: `bpmn set <file> Flow_CheckInvoiceToInvoiceDone id=Flow_CheckInvoiceToBookInvoice`.)';

  /** A copy of start -> Check invoice -> end. */
  function fresh(name: string): string {
    const f = join(dir, name);
    writeFileSync(f, readFileSync(base, 'utf8'));
    return f;
  }

  beforeAll(() => {
    base = join(dir, 'invoice.bpmn');
    ok('new', base, '--name', 'Invoice');
    ok('add', base, 'startEvent', 'Invoice received');
    ok('add', base, 'userTask', 'Check invoice', '--after', 'Event_InvoiceReceived');
    ok('add', base, 'endEvent', 'Invoice done', '--after', 'Activity_CheckInvoice');
  });

  it('--keep-flow-ids keeps the id and names the stale flow with the command that renames it; the command works', () => {
    const f = fresh('keep-flag.bpmn');
    const r = ok('add', f, ...splice, '--keep-flow-ids');
    expect(r.out).toContain(`${STALE}\n`);
    expect(r.out).not.toMatch(/renamed/);
    expect(readFileSync(f, 'utf8')).toContain('<bpmn:sequenceFlow id="Flow_CheckInvoiceToInvoiceDone" sourceRef="Activity_CheckInvoice" targetRef="Activity_BookInvoice" />');
    const command = /`bpmn set <file> (\S+) (id=\S+)`/.exec(r.out)!;
    expect(ok('set', f, command[1]!, command[2]!).out).toMatch(/^changed sequenceFlow Flow_CheckInvoiceToBookInvoice /m);
  });

  it('BPMN_KEEP_FLOW_IDS=1 makes it the default; --no-keep-flow-ids, 0 and an empty value rename', () => {
    let r = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('env-on.bpmn'), ...splice, '--summary');
    expect(r.out).toMatch(/^warning W_FLOW_ID_STALE Flow_CheckInvoiceToInvoiceDone: /m);
    expect(r.out).not.toMatch(/^renamed:/m);
    for (const [env, flag] of [['1', '--no-keep-flow-ids'], ['0', undefined], ['Off', undefined], ['', undefined]] as const) {
      r = okWith({ BPMN_KEEP_FLOW_IDS: env }, 'add', fresh('env-off.bpmn'), ...splice, '--summary', ...(flag ? [flag] : []));
      expect(r.out, `${env} ${flag ?? ''}`).toMatch(/^renamed: Flow_CheckInvoiceToInvoiceDone -> Flow_CheckInvoiceToBookInvoice$/m);
      expect(r.out).not.toMatch(/W_FLOW_ID_STALE/);
    }
    r = okWith({ BPMN_KEEP_FLOW_IDS: 'yes' }, 'add', fresh('env-yes.bpmn'), ...splice, '--json');
    expect(r.json()).not.toHaveProperty('renamed');
    expect(r.json().warnings.added).toEqual([expect.objectContaining({ code: 'W_FLOW_ID_STALE', element: 'Flow_CheckInvoiceToInvoiceDone', related: ['Activity_CheckInvoice', 'Activity_BookInvoice'] })]);
  });

  /** A copy of start -> Check invoice -> Book invoice -> end whose flows have ids that do not name their ends (`ids`: three). */
  function unnamedFlows(name: string, ids: readonly string[]): string {
    const f = fresh(name);
    ok('add', f, ...splice);
    let xml = readFileSync(f, 'utf8');
    ['Flow_InvoiceReceivedToCheckInvoice', 'Flow_CheckInvoiceToBookInvoice', 'Flow_BookInvoiceToInvoiceDone'].forEach((id, i) => (xml = xml.replaceAll(id, ids[i]!)));
    writeFileSync(f, xml);
    return f;
  }

  it('a result says where BPMN_KEEP_FLOW_IDS kept flow ids and that changed it: text, --summary, --json, --summary --json', () => {
    const note = (value: string) => `flow ids kept: BPMN_KEEP_FLOW_IDS=${value} (--no-keep-flow-ids renames flows after their new ends for one command)`;
    // a stale flow id: after the change's own notes, before the warnings
    let r = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('note-text.bpmn'), ...splice);
    expect(r.out).toContain(`\nnote: inserted between Activity_CheckInvoice and Event_InvoiceDone\nnote: ${note('1')}\n${STALE}\n`);
    // --summary prints no notes of its own: this one follows the change lines
    r = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('note-summary.bpmn'), ...splice, '--summary');
    expect(r.out).toContain(`\nchanged: Flow_CheckInvoiceToInvoiceDone\nnote: ${note('1')}\nwarning W_FLOW_ID_STALE Flow_CheckInvoiceToInvoiceDone: `);
    r = okWith({ BPMN_KEEP_FLOW_IDS: 'yes' }, 'add', fresh('note-json.bpmn'), ...splice, '--json');
    expect(r.json().notes).toEqual(['inserted between Activity_CheckInvoice and Event_InvoiceDone', note('yes')]);
    const ops = join(dir, 'note-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'Activity_CheckInvoice' }]));
    r = okWith({ BPMN_KEEP_FLOW_IDS: 'On' }, 'apply', fresh('note-summary-json.bpmn'), ops, '--summary', '--json');
    expect(r.json().notes).toEqual([note('On')]);
    // a move puts the moved node's out-flow back without any warning (numbered flow ids): only the note says why
    const numbered = unnamedFlows('note-numbered.bpmn', ['Flow_1', 'Flow_2', 'Flow_3']);
    const move = ['move', numbered, 'Activity_CheckInvoice', '--after', 'Activity_BookInvoice', '--summary', '--dry-run'];
    r = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, ...move);
    expect(r.out).toMatch(/^changed: Flow_1, Flow_3, Flow_2, Activity_CheckInvoice\nnote: flow ids kept: BPMN_KEEP_FLOW_IDS=1 /m);
    expect(r.out).not.toMatch(/created sequenceFlow|warning/);
    expect(ok(...move).out).toMatch(/^created sequenceFlow: Flow_CheckInvoiceToInvoiceDone\n[\s\S]*^removed: Flow_2$/m);
    // the same move in a batch
    writeFileSync(ops, JSON.stringify([{ op: 'move', ids: ['Activity_CheckInvoice'], after: 'Activity_BookInvoice' }]));
    expect(okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', numbered, ops, '--json', '--dry-run').json().notes).toContain(note('1'));
  });

  it('no note where a flag decides, the variable is unset or off, or the kept ids changed nothing: the output is the one without the variable', () => {
    const f = fresh('note-none.bpmn');
    const numbered = unnamedFlows('note-none-numbered.bpmn', ['Flow_1', 'Flow_2', 'Flow_3']);
    // the ids Camunda Modeler gives
    const modeler = unnamedFlows('note-none-modeler.bpmn', ['Flow_0k3x9ab', 'Flow_1q7m2zd', 'Flow_0w5n1rt']);
    const ops = join(dir, 'note-none-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'connect', source: 'Event_InvoiceReceived', target: 'Event_InvoiceDone', as: '$f' }, { op: 'set', id: '$f', values: { name: 'skip' } }]));
    // a move in place relocates nothing: its flow options change the flow into its node the same in both modes
    const inPlace = join(dir, 'note-none-in-place.json');
    const inPlaceNumbered = join(dir, 'note-none-in-place-numbered.json');
    writeFileSync(inPlace, JSON.stringify([{ op: 'move', ids: ['Activity_CheckInvoice'], after: 'Event_InvoiceReceived', flowName: 'go', flowId: 'Flow_ReceivedToCheck' }]));
    writeFileSync(inPlaceNumbered, JSON.stringify([{ op: 'move', ids: ['Activity_BookInvoice'], after: 'Activity_CheckInvoice', flowName: 'ok' }]));
    expect(ok('apply', f, inPlace, '--dry-run', '--summary').out).toMatch(/^changed: Flow_ReceivedToCheck$/m);
    expect(ok('apply', numbered, inPlaceNumbered, '--dry-run', '--summary').out).toMatch(/^changed: Flow_2$/m);
    const cases: string[][] = [
      ['apply', f, inPlace, '--summary'],
      ['apply', numbered, inPlaceNumbered, '--json'],
      ['add', f, ...splice, '--keep-flow-ids'],
      ['add', f, ...splice, '--no-keep-flow-ids', '--summary'],
      ['set', f, 'Activity_CheckInvoice', 'name=Check bill'],
      // a flow the change creates or removes is the same in both modes, also one a batch created and then changed
      ['connect', f, 'Event_InvoiceReceived', 'Event_InvoiceDone', '--summary'],
      ['remove', f, 'Flow_CheckInvoiceToInvoiceDone', '--json'],
      ['apply', f, ops, '--summary'],
      // a property of a flow, also the rename W_FLOW_ID_STALE's hint gives
      ['set', f, 'Flow_CheckInvoiceToInvoiceDone', 'name=done', '--summary'],
      ['set', f, 'Flow_CheckInvoiceToInvoiceDone', 'id=Flow_CheckInvoiceToBookInvoice', '--summary'],
      // a flow whose id does not name its ends is renamed in neither mode: a splice, a bridging remove, set target=
      ...[numbered, modeler].flatMap((g) => [
        ['add', g, 'userTask', 'Approve invoice', '--after', 'Activity_CheckInvoice', '--summary'],
        ['remove', g, 'Activity_BookInvoice', '--json'],
        ['set', g, g === numbered ? 'Flow_1' : 'Flow_0k3x9ab', 'target=Activity_BookInvoice'],
      ]),
    ];
    for (const args of cases) {
      const plain = ok(...args, '--dry-run').out;
      expect(plain, args.join(' ')).not.toMatch(/flow ids kept/);
      expect(okWith({ BPMN_KEEP_FLOW_IDS: '1' }, ...args, '--dry-run').out, args.join(' ')).toBe(plain);
    }
    for (const env of ['0', 'off', '']) {
      expect(okWith({ BPMN_KEEP_FLOW_IDS: env }, 'add', f, ...splice, '--dry-run').out, env).toBe(ok('add', f, ...splice, '--dry-run').out);
    }
  });

  it('an E_NOT_FOUND of a batch says that BPMN_KEEP_FLOW_IDS kept the flow ids: the id the default renames to does not exist', () => {
    const ops = join(dir, 'note-error-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'Activity_CheckInvoice' }, { op: 'set', id: 'Flow_CheckInvoiceToBookInvoice', values: { name: 'ok' } }]));
    const f = fresh('note-error.bpmn');
    expect(ok('apply', f, ops, '--dry-run', '--summary').out).toMatch(/^renamed: Flow_CheckInvoiceToInvoiceDone -> Flow_CheckInvoiceToBookInvoice$/m);
    const kept = 'If it is the id a flow an earlier op gave other ends would be renamed to: flow ids are kept here (BPMN_KEEP_FLOW_IDS=1), so that flow kept its old id; use the old id, or --no-keep-flow-ids to rename it after its new ends.';
    let r = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', f, ops, '--dry-run');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^error E_NOT_FOUND: No element with id "Flow_CheckInvoiceToBookInvoice"\n/);
    expect(r.err).toContain(` to list ids. ${kept}\n`);
    r = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', f, ops, '--dry-run', '--json');
    expect(r.json().error.hint.endsWith(` to list ids. ${kept}`)).toBe(true);
    // a flag decides: the error as without the hint
    const flag = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', f, ops, '--dry-run', '--keep-flow-ids');
    expect(flag.err).not.toContain('BPMN_KEEP_FLOW_IDS');
    expect(bpmn('apply', f, ops, '--dry-run', '--keep-flow-ids').err).toBe(flag.err);
    // one op: the ids it names are the file's, whatever the mode
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'set', f, 'Flow_Nowhere', 'name=x').err).not.toContain('BPMN_KEEP_FLOW_IDS');
  });

  it('apply, remove and set target= keep ids too; --strict exits 5 on the warning', () => {
    const ops = join(dir, 'keep-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'Activity_CheckInvoice' }]));
    expect(ok('apply', fresh('keep-apply.bpmn'), ops, '--keep-flow-ids').out).toContain(STALE);
    const bridged = ok('remove', fresh('keep-remove.bpmn'), 'Activity_CheckInvoice', '--keep-flow-ids').out;
    expect(bridged).toMatch(/^warning W_FLOW_ID_STALE Flow_InvoiceReceivedToCheckInvoice: .*`bpmn set <file> Flow_InvoiceReceivedToCheckInvoice id=Flow_InvoiceReceivedToInvoiceDone`/m);
    const retargeted = ok('set', fresh('keep-set.bpmn'), 'Flow_InvoiceReceivedToCheckInvoice', 'target=Event_InvoiceDone', '--keep-flow-ids').out;
    expect(retargeted).toMatch(/^warning W_FLOW_ID_STALE Flow_InvoiceReceivedToCheckInvoice: /m);
    const strict = bpmn('add', fresh('keep-strict.bpmn'), ...splice, '--keep-flow-ids', '--strict');
    expect(strict.code).toBe(5);
    expect(strict.out).toContain(STALE);
  });

  it('another BPMN_KEEP_FLOW_IDS value is a usage error of a mutating command (unless a flag decides); show and validate ignore it', () => {
    const f = fresh('env-bad.bpmn');
    const before = readFileSync(f, 'utf8');
    let r = bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', f, ...splice);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error E_USAGE: BPMN_KEEP_FLOW_IDS=maybe is not a switch value$/m);
    expect(r.err).toMatch(/^ {2}hint: Set BPMN_KEEP_FLOW_IDS=1 \(true, yes, on\) to keep flow ids/m);
    r = bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', f, ...splice, '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error.code).toBe('E_USAGE');
    expect(readFileSync(f, 'utf8')).toBe(before);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', f, ...splice, '--keep-flow-ids', '--dry-run').code).toBe(0);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'show', f).code).toBe(0);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'validate', f).code).toBe(0);
  });
});

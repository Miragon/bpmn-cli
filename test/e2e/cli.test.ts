/**
 * End-to-end: builds the CLI once and drives it through a realistic session.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Doc } from '../../src/domain/document/Doc.js';

const ROOT = join(import.meta.dirname, '..', '..');
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

/** bpmn with these environment variables on top of the test's (test/helpers/setup.ts cleared the shell's BPMN_KEEP_FLOW_IDS). */
function bpmnWith(env: Record<string, string>, ...args: string[]): Run {
  const spawned = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: dir, input: '', env: { ...process.env, ...env } });
  return {
    code: spawned.status ?? -1,
    out: spawned.stdout,
    err: spawned.stderr,
    json: () => JSON.parse(spawned.stdout || spawned.stderr),
  };
}

function ok(...args: string[]): Run {
  return okWith({}, ...args);
}

function okWith(env: Record<string, string>, ...args: string[]): Run {
  const result = bpmnWith(env, ...args);
  if (result.code !== 0) throw new Error(`bpmn ${args.join(' ')} failed (${result.code}):\n${result.err}\n${result.out}`);
  return result;
}

async function reparse(): Promise<Doc> {
  const doc = await Doc.fromXml(readFileSync(file, 'utf8'));
  expect(doc.importWarnings).toHaveLength(0);
  return doc;
}

function diIds(xml: string): string[] {
  return [...xml.matchAll(/bpmnElement="([^"]+)"/g)].map((match) => match[1]!);
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
    const result = ok('new', file, '--name', 'Order handling', '--target', 'camunda8');
    expect(result.out).toMatch(/orderHandling/);
    expect(result.out).toMatch(/written: /);
    const xml = readFileSync(file, 'utf8');
    expect(xml).toContain('xmlns:zeebe');
    expect(xml).toContain('bpmndi:BPMNDiagram');
    await reparse();
    expect(bpmn('new', file).code).toBe(4);
  });

  it('builds a process with the placement grammar', async () => {
    ok('add', file, 'startEvent', 'Order received');
    ok('add', file, 'userTask', 'Check invoice', '--after', 'startEvent_orderReceived');
    ok('add', file, 'xor', 'Invoice ok?', '--after', 'userTask_checkInvoice');
    let result = ok('add', file, 'serviceTask', 'Book invoice', '--after', 'gateway_invoiceOk', '--flow-name', 'yes', '--condition', '${ok}');
    expect(result.out).toMatch(/appended after gateway_invoiceOk/);
    ok('add', file, 'endEvent', 'Invoice booked', '--after', 'serviceTask_bookInvoice');
    result = ok('add', file, 'userTask', 'Clarify invoice', '--after', 'gateway_invoiceOk', '--flow-name', 'no', '--default', '--to', 'userTask_checkInvoice');
    expect(result.out).toMatch(/userTask_clarifyInvoice -> userTask_checkInvoice/);
    result = ok('add', file, 'boundaryEvent:timer', '2 days', '--on', 'userTask_checkInvoice', '--timer', 'PT2D', '--non-interrupting');
    expect(result.out).toMatch(/attached to userTask_checkInvoice/);
    ok('add', file, 'sendTask', 'Remind clerk', '--after', 'event_timer2Days');
    const doc = await reparse();
    const gw = doc.get('gateway_invoiceOk')!;
    expect(doc.outgoing(gw)).toHaveLength(2);
    expect(gw.get<any>('default').get('name')).toBe('no');
    const yes = doc.outgoing(gw).find((flow) => flow.get('name') === 'yes')!;
    expect(yes.get<any>('conditionExpression').body).toBe('${ok}');
    const be = doc.get('event_timer2Days')!;
    expect(be.get('cancelActivity')).toBe(false);
    expect(be.get<any>('eventDefinitions')[0].timeDuration.body).toBe('PT2D');
    const xml = readFileSync(file, 'utf8');
    for (const id of ['startEvent_orderReceived', 'userTask_checkInvoice', 'gateway_invoiceOk', 'serviceTask_bookInvoice', 'endEvent_invoiceBooked', 'userTask_clarifyInvoice', 'event_timer2Days', 'sendTask_remindClerk']) {
      expect(diIds(xml)).toContain(id);
    }
  });

  it('shows the model without coordinates', () => {
    const result = ok('show', file);
    expect(result.out).toMatch(/process orderHandling/);
    expect(result.out).toMatch(/userTask userTask_checkInvoice "Check invoice"/);
    expect(result.out).toMatch(/exclusiveGateway gateway_invoiceOk/);
    expect(result.out).toMatch(/boundaryEvent:timer event_timer2Days/);
    expect(result.out).not.toMatch(/x=|Bounds|waypoint/);
    const shown = ok('show', file, '--json').json();
    expect(shown.processes[0].nodes.map((node: any) => node.id)).toContain('userTask_checkInvoice');
    const gatewayView = ok('show', file, 'gateway_invoiceOk', '--json').json();
    expect(gatewayView.kind).toBe('exclusiveGateway');
    expect(gatewayView.outgoing).toHaveLength(2);
    const found = ok('find', file, 'invoice', '--json').json();
    expect(found.length).toBeGreaterThan(2);
  });

  it('validates, sets properties and manages extensions', async () => {
    let result = ok('validate', file);
    expect(result.out).toMatch(/layout: ok/);
    ok('set', file, 'userTask_checkInvoice', 'name=Check the invoice', 'zeebe:modelerTemplate=check-form', 'doc=Compare with purchase order');
    ok('ext', 'add', file, 'serviceTask_bookInvoice', 'zeebe:taskDefinition', 'type=book-invoice', 'retries=3');
    result = ok('ext', 'list', file, 'serviceTask_bookInvoice');
    expect(result.out).toMatch(/zeebe:taskDefinition/);
    const doc = await reparse();
    const checkTask = doc.get('userTask_checkInvoice')!;
    expect(checkTask.get('name')).toBe('Check the invoice');
    expect(checkTask.$attrs['zeebe:modelerTemplate']).toBe('check-form');
    expect(checkTask.get<any>('documentation')[0].text).toBe('Compare with purchase order');
    const xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/<zeebe:taskDefinition type="book-invoice" retries="3"/);
    result = ok('set', file, 'serviceTask_bookInvoice', 'loop=parallel', 'cardinality=3');
    const doc2 = await reparse();
    expect(doc2.get('serviceTask_bookInvoice')!.get<any>('loopCharacteristics').$type).toBe('bpmn:MultiInstanceLoopCharacteristics');
  });

  it('retypes, removes with bridging and reorders', async () => {
    ok('retype', file, 'serviceTask_bookInvoice', 'userTask');
    let doc = await reparse();
    expect(doc.get('serviceTask_bookInvoice')!.$type).toBe('bpmn:UserTask');
    expect(doc.incoming(doc.get('serviceTask_bookInvoice')!)).toHaveLength(1);
    const result = ok('remove', file, 'serviceTask_bookInvoice');
    expect(result.out).toMatch(/bridged/);
    doc = await reparse();
    expect(doc.get('serviceTask_bookInvoice')).toBeUndefined();
    const yes = doc.outgoing(doc.get('gateway_invoiceOk')!).find((flow) => flow.get('name') === 'yes')!;
    expect(yes.get<any>('targetRef').id).toBe('endEvent_invoiceBooked');
    const flows = doc.outgoing(doc.get('gateway_invoiceOk')!).map((flow) => flow.get<string>('id'));
    ok('order', file, 'gateway_invoiceOk', flows[1]!, flows[0]!);
    doc = await reparse();
    expect(doc.outgoing(doc.get('gateway_invoiceOk')!).map((flow) => flow.get('id'))).toEqual([flows[1], flows[0]]);
  });

  it('applies a JSON batch with a split macro', async () => {
    const ops = {
      ops: [
        { op: 'add', kind: 'subProcess', name: 'Payment', after: 'gateway_invoiceOk', before: 'endEvent_invoiceBooked' },
        { op: 'add', kind: 'startEvent', name: 'Pay start', in: 'subProcess_payment' },
        { op: 'add', kind: 'serviceTask', name: 'Charge card', after: 'startEvent_payStart' },
        { op: 'add', kind: 'endEvent', name: 'Paid', after: 'serviceTask_chargeCard' },
        {
          op: 'split',
          after: 'serviceTask_chargeCard',
          kind: 'exclusiveGateway',
          name: 'Charged?',
          branches: [
            { flowName: 'yes', condition: '${charged}', nodes: [] },
            { flowName: 'no', default: true, nodes: [{ kind: 'userTask', name: 'Retry manually' }] },
          ],
        },
        { op: 'add', kind: 'dataObject', name: 'Invoice', in: 'orderHandling' },
        { op: 'connect', source: 'userTask_checkInvoice', target: 'dataObject_invoice' },
        // an unnamed element gets a hashed id: give it one to refer to it later in the batch
        { op: 'add', kind: 'textAnnotation', id: 'TextAnnotation_Fallback', text: 'Manual fallback', in: 'subProcess_payment' },
        { op: 'connect', source: 'TextAnnotation_Fallback', target: 'userTask_retryManually' },
      ],
    };
    const opsFile = join(dir, 'ops.json');
    writeFileSync(opsFile, JSON.stringify(ops));
    const result = ok('apply', file, opsFile, '--json');
    const applied = result.json();
    expect(applied.ok).toBe(true);
    expect(applied.created.map((created: any) => created.id)).toEqual(expect.arrayContaining(['subProcess_payment', 'gateway_charged', 'userTask_retryManually', 'dataObject_invoice']));
    const doc = await reparse();
    const sub = doc.get('subProcess_payment')!;
    expect(doc.flowNodes(sub).length).toBeGreaterThanOrEqual(5);
    const xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/bpmnElement="subProcess_payment" isExpanded="true"/);
    expect(diIds(xml)).toContain('userTask_retryManually');
    expect(diIds(xml)).toContain('dataObject_invoice');
    expect(diIds(xml)).toContain('TextAnnotation_Fallback');
    const report = ok('validate', file, '--json').json();
    expect(report.ok).toBe(true);
  });

  it('collapses and re-expands sub-processes through layout', async () => {
    ok('layout', file, '--collapse', 'subProcess_payment');
    let xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/BPMNPlane_subProcess_payment/);
    expect(xml).not.toMatch(/bpmnElement="subProcess_payment" isExpanded="true"/);
    ok('add', file, 'task', 'Unrelated', '--in', 'orderHandling');
    xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/BPMNPlane_subProcess_payment/);
    ok('set', file, 'subProcess_payment', 'expanded=true');
    xml = readFileSync(file, 'utf8');
    expect(xml).toMatch(/bpmnElement="subProcess_payment" isExpanded="true"/);
  });

  it('adds pools and message flows', async () => {
    ok('add', file, 'participant', 'Shop');
    ok('add', file, 'participant', 'Customer', '--black-box');
    const result = ok('connect', file, 'userTask_checkInvoice', 'participant_customer', '--name', 'Clarification request');
    expect(result.out).toMatch(/messageFlow/);
    const doc = await reparse();
    expect(doc.collaboration()).toBeDefined();
    expect(doc.participants()).toHaveLength(2);
    expect(doc.messageFlows()).toHaveLength(1);
    const xml = readFileSync(file, 'utf8');
    expect(diIds(xml)).toContain('participant_shop');
    expect(diIds(xml)).toContain('participant_customer');
  });

  it('reports errors with codes and exit codes', () => {
    let result = bpmn('add', file, 'userTask', 'X', '--after', 'Nope');
    expect(result.code, result.err).toBe(2);
    expect(result.err).toMatch(/error E_NOT_FOUND/);
    result = bpmn('add', file, 'choreographyTask', 'X');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/error E_UNSUPPORTED_KIND/);
    result = bpmn('show', join(dir, 'missing.bpmn'));
    expect(result.code).toBe(4);
    result = bpmn('add', file, 'userTask', 'X', '--after', 'Nope', '--json');
    expect(result.code).toBe(2);
    expect(JSON.parse(result.err).error.code).toBe('E_NOT_FOUND');
    result = bpmn('add', file, 'userTask', 'Y', '--after', 'gateway_invoiceOk', '--dry-run');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/dry run/);
    result = bpmn('show', file, 'userTask_y');
    expect(result.code).toBe(2);
  });

  it('prints self-description', () => {
    const kindsView = ok('kinds', '--json').json();
    expect(kindsView.kinds.map((kindEntry: any) => kindEntry.kind)).toContain('userTask');
    expect(ok('guide').out).toMatch(/apply/);
    expect(ok('kinds').out).toMatch(/boundaryEvent/);
  });
});

describe('complex gateways (#74)', () => {
  it('are modelled in a plain file; the Camunda 7 / 8 profiles report them', () => {
    const modelFile = join(dir, 'complex.bpmn');
    ok('new', modelFile, '--id', 'P');
    ok('add', modelFile, 'start', 'S');
    expect(ok('add', modelFile, 'complex', 'Enough reviews?', '--after', 'startEvent_s').out).toMatch(/created complexGateway gateway_enoughReviews/);
    ok('add', modelFile, 'task', 'Legal', '--after', 'gateway_enoughReviews');
    ok('add', modelFile, 'task', 'Finance', '--after', 'gateway_enoughReviews');
    ok('add', modelFile, 'parallelGateway', '--after', 'task_legal', '--id', 'Join');
    ok('connect', modelFile, 'task_finance', 'Join');
    ok('add', modelFile, 'end', 'Done', '--after', 'Join');
    ok('retype', modelFile, 'Join', 'complexGateway');
    expect(ok('retype', modelFile, 'gateway_enoughReviews', 'inclusiveGateway').out).toMatch(/changed inclusiveGateway gateway_enoughReviews/);
    ok('retype', modelFile, 'gateway_enoughReviews', 'complex');
    expect(ok('validate', modelFile).out).toMatch(/valid, 0 warning/);
    expect(ok('layout', modelFile).code).toBe(0);
    expect(ok('render', modelFile, '-o', join(dir, 'complex.svg')).out).toMatch(/wrote/);
    expect(bpmn('validate', modelFile, '--platform', 'c7').out).toMatch(/W_C7_DEPLOY_COMPLEX_GATEWAY gateway_enoughReviews/);
    expect(bpmn('validate', modelFile, '--platform', 'c8').out).toMatch(/W_C8_DEPLOY_UNSUPPORTED Join/);
    expect(bpmn('remove', modelFile, 'Join').err).toMatch(/E_AMBIGUOUS_BRIDGE: Join is a complex join/);
    expect(ok('remove', modelFile, 'Join', '--bridge-all').out).toMatch(/note: Join synchronised task_legal, task_finance/);
  });
});

/**
 * Contracts an agent relies on: documented error formats and exit codes, the
 * same validation on the CLI as in `apply`, and options that are never lost.
 */
describe('bpmn cli contracts', () => {
  let modelFile: string;

  beforeAll(() => {
    modelFile = join(dir, 'contracts.bpmn');
    ok('new', modelFile, '--id', 'P');
    ok('add', modelFile, 'start', 'S');
    ok('add', modelFile, 'subProcess', 'Sub', '--after', 'startEvent_s');
    ok('add', modelFile, 'start', 'Inner', '--in', 'subProcess_sub');
  });

  it('reports a missing ops file as an I/O error', () => {
    let result = bpmn('apply', modelFile, join(dir, 'missing.json'));
    expect(result.code).toBe(4);
    expect(result.err).toMatch(/^error E_FILE_NOT_FOUND: Cannot read ops file/);
    result = bpmn('apply', modelFile, join(dir, 'missing.json'), '--json');
    expect(result.code).toBe(4);
    expect(JSON.parse(result.err).error.code).toBe('E_FILE_NOT_FOUND');
    result = bpmn('apply', modelFile, dir);
    expect(result.code).toBe(4);
    expect(result.err).toMatch(/^error E_IO/);
  });

  it('renders commander parse errors in the documented format', () => {
    let result = bpmn('show', modelFile, '--frob', '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.err).error).toMatchObject({ code: 'E_USAGE', message: expect.stringMatching(/unknown option '--frob'/) });
    result = bpmn('add', modelFile);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^error E_USAGE: missing required argument 'kind'/);
    result = bpmn('frobnicate');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^error E_USAGE: unknown command 'frobnicate'/);
    expect(result.err).toMatch(/bpmn guide/);
    result = bpmn('find', modelFile, 'x', '--kind', 'frob', '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.err).error.code).toBe('E_UNKNOWN_KIND');
    expect(bpmn('--help').code).toBe(0);
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(bpmn('--version').out.trim()).toBe(pkg.version);
    result = bpmn('layout', '--help');
    expect(result.code).toBe(0);
    expect(result.out).not.toMatch(/--no-layout/);
  });

  it('validates and reports layout --expand / --collapse', () => {
    let result = ok('layout', modelFile, '--expand', 'subProcess_sub');
    expect(result.out).toMatch(/changed subProcess subProcess_sub "Sub" - expanded=true/);
    result = bpmn('layout', modelFile, '--collapse', 'startEvent_s');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/error E_WRONG_KIND/);
    result = bpmn('layout', modelFile, '--expand', 'subProcess_su', '--json');
    expect(result.code).toBe(2);
    const cliError = JSON.parse(result.err).error;
    expect(cliError.code).toBe('E_NOT_FOUND');
    expect(cliError.candidates).toEqual(['subProcess_sub']);
    expect(bpmn('layout', modelFile, '--no-layout').code).toBe(1);
    expect(bpmn('layout', modelFile, '--expand', 'subProcess_sub', '--collapse', 'subProcess_sub').code).toBe(1);
    result = ok('layout', modelFile, '--collapse', 'subProcess_sub', '--json');
    expect(result.json().changed).toEqual([{ id: 'subProcess_sub', kind: 'subProcess', name: 'Sub', detail: 'expanded=false' }]);
    expect(result.json().layout.expanded).toEqual([]);
    ok('layout', modelFile, '--expand', 'subProcess_sub');
  });

  it('keeps collapse requests made with --no-layout', () => {
    let result = ok('set', modelFile, 'subProcess_sub', 'expanded=false', '--no-layout');
    expect(result.out).toMatch(/expanded=false/);
    expect(readFileSync(modelFile, 'utf8')).toMatch(/bpmnElement="subProcess_sub" isExpanded="false"/);
    expect(ok('show', modelFile, 'subProcess_sub').out).toMatch(/expanded: false/);
    ok('layout', modelFile);
    let xml = readFileSync(modelFile, 'utf8');
    expect(xml).toMatch(/BPMNPlane_subProcess_sub/);
    expect(xml).not.toMatch(/bpmnElement="subProcess_sub" isExpanded="true"/);
    result = ok('add', modelFile, 'subProcess', 'Other', '--after', 'subProcess_sub', '--collapsed', '--no-layout');
    expect(result.out).toMatch(/laid out collapsed/);
    ok('layout', modelFile);
    xml = readFileSync(modelFile, 'utf8');
    expect(xml).toMatch(/BPMNPlane_subProcess_other/);
    expect(xml).not.toMatch(/bpmnElement="subProcess_other" isExpanded="true"/);
    ok('layout', modelFile, '--expand', 'subProcess_sub,subProcess_other');
    expect(readFileSync(modelFile, 'utf8')).toMatch(/bpmnElement="subProcess_other" isExpanded="true"/);
  });

  it('re-attaches boundary events with move --on', async () => {
    const moveFile = join(dir, 'move.bpmn');
    ok('new', moveFile, '--id', 'M');
    ok('add', moveFile, 'task', 'A', '--in', 'M');
    ok('add', moveFile, 'task', 'B', '--in', 'M');
    ok('add', moveFile, 'boundary:timer', 'T', '--on', 'task_a', '--timer', 'PT1H');
    const result = ok('move', moveFile, 'event_t', '--on', 'task_b');
    expect(result.out).toMatch(/moved onto task_b \(was task_a\)/);
    const doc = await Doc.fromXml(readFileSync(moveFile, 'utf8'));
    expect(doc.get('event_t')!.get<any>('attachedToRef').id).toBe('task_b');
    expect(bpmn('move', moveFile, 'event_t').err).toMatch(/--on/);
    expect(bpmn('move', moveFile, 'event_t', '--on', 'task_a', '--in', 'M').err).toMatch(/E_USAGE: --in and --on cannot be combined/);
  });

  it('applies the ops JSON rules to CLI flags', () => {
    const before = readFileSync(modelFile, 'utf8');
    let result = bpmn('add', modelFile, 'task', 'FN', '--in', 'P', '--flow-name', 'x', '--condition', '${c}');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/error E_USAGE: --flow-name, --condition describe the flow into the node and need --after, --before or --flow/);
    result = bpmn('add', modelFile, 'task', 'Dup', '--if-absent');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/--if-absent needs an explicit --id/);
    result = bpmn('add', modelFile, 'task', 'X', '--after', 'startEvent_s', '--condition', '${c}', '--default');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/--default and --condition are mutually exclusive/);
    result = bpmn('connect', modelFile, 'startEvent_s', 'subProcess_sub', '--condition', '${c}', '--default');
    expect(result.code).toBe(1);
    result = bpmn('add', modelFile, 'task', 'X', '--after', 'startEvent_s', '--in', 'P');
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/--after and --in cannot be combined/);
    expect(readFileSync(modelFile, 'utf8')).toBe(before);
  });

  it('does not expose diagram interchange ids', () => {
    let result = bpmn('show', modelFile, 'BPMNShape_startEvent_s');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/error E_NOT_FOUND/);
    expect(result.err).not.toMatch(/candidates:.*BPMNShape/);
    result = bpmn('show', modelFile, 'startEvent_');
    expect(result.err).toMatch(/candidates: startEvent_inner, startEvent_s$/m);
    expect(bpmn('remove', modelFile, 'BPMNPlane_P').code).toBe(2);
  });

  it('renames a flow after its new ends without cutting an id that fits into 64 characters (#31)', () => {
    const syncFile = join(dir, 'sync.bpmn');
    ok('new', syncFile, '--name', 'Sync');
    ok('add', syncFile, 'start', 'Every minute');
    ok('add', syncFile, 'serviceTask', 'Consignations synchronisieren', '--after', 'startEvent_everyMinute');
    ok('add', syncFile, 'end', 'Consignations aktualisiert', '--after', 'serviceTask_consignationsSynchronisieren');
    const result = ok('add', syncFile, 'serviceTask', 'Consignations protokollieren', '--after', 'serviceTask_consignationsSynchronisieren');
    expect(result.out).toMatch(
      /^changed sequenceFlow flow_consignationsSynchronisierenToConsignationsProtokollieren - .* \(renamed from flow_consignationsSynchronisierenToConsignationsAktualisiert: its id named its old ends\)$/m,
    );
  });

  it('does not write a result that equals the file, and says so', () => {
    const before = readFileSync(modelFile, 'utf8');
    let result = ok('set', modelFile, 'startEvent_s', 'name=S');
    expect(result.out).toMatch(/^unchanged: .*contracts\.bpmn \(the result equals the file; nothing written\)$/m);
    expect(result.out).not.toMatch(/^written: /m);
    result = ok('set', modelFile, 'startEvent_s', 'name=S', '--json');
    expect(result.json()).toMatchObject({ ok: true, written: false, unchanged: true });
    result = ok('set', modelFile, 'startEvent_s', 'name=S', '--dry-run');
    expect(result.out).toMatch(/^dry run: .* not written \(unchanged\)$/m);
    expect(readFileSync(modelFile, 'utf8')).toBe(before);
    result = ok('set', modelFile, 'startEvent_s', 'name=Started', '--json');
    expect(result.json()).toMatchObject({ written: true, unchanged: false });
  });

  // a pipe is non-blocking once anything touched process.stdin: a synchronous read failed with EAGAIN
  it.skipIf(process.platform === 'win32')('reads a model from a pipe whose writer is slower than the start or pauses (no EAGAIN)', () => {
    const piped = (script: string) => spawnSync('/bin/sh', ['-c', script, 'sh', modelFile, process.execPath, BIN], { encoding: 'utf8', cwd: dir });
    let result = piped('(sleep 0.5; cat "$1") | "$2" "$3" validate - --json --no-lint-config');
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, file: '-' });
    result = piped('(head -c 200 "$1"; sleep 0.5; tail -c +201 "$1") | "$2" "$3" show -');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('subProcess_sub');
    result = piped('(sleep 0.5; echo \'[{"op":"set","id":"startEvent_s","values":{"name":"Started late"}}]\') | "$2" "$3" apply "$1" - --dry-run --json');
    expect(result.status, result.stderr).toBe(0);
  });

  it('a write to a directory (-o) is E_IO and leaves no temp file', () => {
    const target = join(dir, 'adir.bpmn');
    mkdirSync(target);
    const result = bpmn('add', modelFile, 'task', 'X', '--after', 'startEvent_s', '-o', target);
    expect(result.code).toBe(4);
    expect(result.err).toMatch(/^error E_IO: Cannot write .*adir\.bpmn: it is a directory\n/);
    expect(readdirSync(dir).filter((fileName) => fileName.endsWith('.tmp'))).toEqual([]);
  });
});

describe('flow ids kept (--keep-flow-ids, BPMN_KEEP_FLOW_IDS)', () => {
  let base: string;
  const splice = ['serviceTask', 'Book invoice', '--after', 'userTask_checkInvoice'];
  const STALE = 'warning W_FLOW_ID_STALE flow_checkInvoiceToInvoiceDone: Flow flow_checkInvoiceToInvoiceDone kept its id, which names its old ends userTask_checkInvoice -> endEvent_invoiceDone; it now runs userTask_checkInvoice -> serviceTask_bookInvoice  (Code and tests that use the id keep working; to rename it together with them: `bpmn set <file> flow_checkInvoiceToInvoiceDone id=flow_checkInvoiceToBookInvoice`.)';

  /** A copy of start -> Check invoice -> end. */
  function fresh(name: string): string {
    const copy = join(dir, name);
    writeFileSync(copy, readFileSync(base, 'utf8'));
    return copy;
  }

  beforeAll(() => {
    base = join(dir, 'invoice.bpmn');
    ok('new', base, '--name', 'Invoice');
    ok('add', base, 'startEvent', 'Invoice received');
    ok('add', base, 'userTask', 'Check invoice', '--after', 'startEvent_invoiceReceived');
    ok('add', base, 'endEvent', 'Invoice done', '--after', 'userTask_checkInvoice');
  });

  it('--keep-flow-ids keeps the id and names the stale flow with the command that renames it; the command works', () => {
    const modelFile = fresh('keep-flag.bpmn');
    const result = ok('add', modelFile, ...splice, '--keep-flow-ids');
    expect(result.out).toContain(`${STALE}\n`);
    expect(result.out).not.toMatch(/renamed/);
    expect(readFileSync(modelFile, 'utf8')).toContain('<bpmn:sequenceFlow id="flow_checkInvoiceToInvoiceDone" sourceRef="userTask_checkInvoice" targetRef="serviceTask_bookInvoice" />');
    const command = /`bpmn set <file> (\S+) (id=\S+)`/.exec(result.out)!;
    expect(ok('set', modelFile, command[1]!, command[2]!).out).toMatch(/^changed sequenceFlow flow_checkInvoiceToBookInvoice /m);
  });

  it('BPMN_KEEP_FLOW_IDS=1 makes it the default; --no-keep-flow-ids, 0 and an empty value rename', () => {
    let result = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('env-on.bpmn'), ...splice, '--summary');
    expect(result.out).toMatch(/^warning W_FLOW_ID_STALE flow_checkInvoiceToInvoiceDone: /m);
    expect(result.out).not.toMatch(/^renamed:/m);
    for (const [env, flag] of [['1', '--no-keep-flow-ids'], ['0', undefined], ['Off', undefined], ['', undefined]] as const) {
      result = okWith({ BPMN_KEEP_FLOW_IDS: env }, 'add', fresh('env-off.bpmn'), ...splice, '--summary', ...(flag ? [flag] : []));
      expect(result.out, `${env} ${flag ?? ''}`).toMatch(/^renamed: flow_checkInvoiceToInvoiceDone -> flow_checkInvoiceToBookInvoice$/m);
      expect(result.out).not.toMatch(/W_FLOW_ID_STALE/);
    }
    result = okWith({ BPMN_KEEP_FLOW_IDS: 'yes' }, 'add', fresh('env-yes.bpmn'), ...splice, '--json');
    expect(result.json()).not.toHaveProperty('renamed');
    expect(result.json().warnings.added).toEqual([expect.objectContaining({ code: 'W_FLOW_ID_STALE', element: 'flow_checkInvoiceToInvoiceDone', related: ['userTask_checkInvoice', 'serviceTask_bookInvoice'] })]);
  });

  /** A copy of start -> Check invoice -> Book invoice -> end whose flows have ids that do not name their ends (`ids`: three). */
  function unnamedFlows(name: string, ids: readonly string[]): string {
    const modelFile = fresh(name);
    ok('add', modelFile, ...splice);
    let xml = readFileSync(modelFile, 'utf8');
    ['flow_invoiceReceivedToCheckInvoice', 'flow_checkInvoiceToBookInvoice', 'flow_bookInvoiceToInvoiceDone'].forEach((id, flowIndex) => (xml = xml.replaceAll(id, ids[flowIndex]!)));
    writeFileSync(modelFile, xml);
    return modelFile;
  }

  it('a result says where BPMN_KEEP_FLOW_IDS kept flow ids and that changed it: text, --summary, --json, --summary --json', () => {
    const note = (value: string) => `flow ids kept: BPMN_KEEP_FLOW_IDS=${value} (--no-keep-flow-ids renames flows after their new ends for one command)`;
    // a stale flow id: after the change's own notes, before the warnings
    let result = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('note-text.bpmn'), ...splice);
    expect(result.out).toContain(`\nnote: inserted between userTask_checkInvoice and endEvent_invoiceDone\nnote: ${note('1')}\n${STALE}\n`);
    // --summary prints no notes of its own: this one follows the change lines
    result = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'add', fresh('note-summary.bpmn'), ...splice, '--summary');
    expect(result.out).toContain(`\nchanged: flow_checkInvoiceToInvoiceDone\nnote: ${note('1')}\nwarning W_FLOW_ID_STALE flow_checkInvoiceToInvoiceDone: `);
    result = okWith({ BPMN_KEEP_FLOW_IDS: 'yes' }, 'add', fresh('note-json.bpmn'), ...splice, '--json');
    expect(result.json().notes).toEqual(['inserted between userTask_checkInvoice and endEvent_invoiceDone', note('yes')]);
    const ops = join(dir, 'note-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'userTask_checkInvoice' }]));
    result = okWith({ BPMN_KEEP_FLOW_IDS: 'On' }, 'apply', fresh('note-summary-json.bpmn'), ops, '--summary', '--json');
    expect(result.json().notes).toEqual([note('On')]);
    // a move puts the moved node's out-flow back without any warning (numbered flow ids): only the note says why
    const numbered = unnamedFlows('note-numbered.bpmn', ['Flow_1', 'Flow_2', 'Flow_3']);
    const move = ['move', numbered, 'userTask_checkInvoice', '--after', 'serviceTask_bookInvoice', '--summary', '--dry-run'];
    result = okWith({ BPMN_KEEP_FLOW_IDS: '1' }, ...move);
    expect(result.out).toMatch(/^changed: Flow_1, Flow_3, Flow_2, userTask_checkInvoice\nnote: flow ids kept: BPMN_KEEP_FLOW_IDS=1 /m);
    expect(result.out).not.toMatch(/created sequenceFlow|warning/);
    expect(ok(...move).out).toMatch(/^created sequenceFlow: flow_checkInvoiceToInvoiceDone\n[\s\S]*^removed: Flow_2$/m);
    // the same move in a batch
    writeFileSync(ops, JSON.stringify([{ op: 'move', ids: ['userTask_checkInvoice'], after: 'serviceTask_bookInvoice' }]));
    expect(okWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', numbered, ops, '--json', '--dry-run').json().notes).toContain(note('1'));
  });

  it('no note where a flag decides, the variable is unset or off, or the kept ids changed nothing: the output is the one without the variable', () => {
    const modelFile = fresh('note-none.bpmn');
    const numbered = unnamedFlows('note-none-numbered.bpmn', ['Flow_1', 'Flow_2', 'Flow_3']);
    // the ids Camunda Modeler gives
    const modeler = unnamedFlows('note-none-modeler.bpmn', ['Flow_0k3x9ab', 'Flow_1q7m2zd', 'Flow_0w5n1rt']);
    const ops = join(dir, 'note-none-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'connect', source: 'startEvent_invoiceReceived', target: 'endEvent_invoiceDone', as: '$f' }, { op: 'set', id: '$f', values: { name: 'skip' } }]));
    // a move in place relocates nothing: its flow options change the flow into its node the same in both modes
    const inPlace = join(dir, 'note-none-in-place.json');
    const inPlaceNumbered = join(dir, 'note-none-in-place-numbered.json');
    writeFileSync(inPlace, JSON.stringify([{ op: 'move', ids: ['userTask_checkInvoice'], after: 'startEvent_invoiceReceived', flowName: 'go', flowId: 'Flow_ReceivedToCheck' }]));
    writeFileSync(inPlaceNumbered, JSON.stringify([{ op: 'move', ids: ['serviceTask_bookInvoice'], after: 'userTask_checkInvoice', flowName: 'ok' }]));
    expect(ok('apply', modelFile, inPlace, '--dry-run', '--summary').out).toMatch(/^changed: Flow_ReceivedToCheck$/m);
    expect(ok('apply', numbered, inPlaceNumbered, '--dry-run', '--summary').out).toMatch(/^changed: Flow_2$/m);
    const cases: string[][] = [
      ['apply', modelFile, inPlace, '--summary'],
      ['apply', numbered, inPlaceNumbered, '--json'],
      ['add', modelFile, ...splice, '--keep-flow-ids'],
      ['add', modelFile, ...splice, '--no-keep-flow-ids', '--summary'],
      ['set', modelFile, 'userTask_checkInvoice', 'name=Check bill'],
      // a flow the change creates or removes is the same in both modes, also one a batch created and then changed
      ['connect', modelFile, 'startEvent_invoiceReceived', 'endEvent_invoiceDone', '--summary'],
      ['remove', modelFile, 'flow_checkInvoiceToInvoiceDone', '--json'],
      ['apply', modelFile, ops, '--summary'],
      // a property of a flow, also the rename W_FLOW_ID_STALE's hint gives
      ['set', modelFile, 'flow_checkInvoiceToInvoiceDone', 'name=done', '--summary'],
      ['set', modelFile, 'flow_checkInvoiceToInvoiceDone', 'id=flow_checkInvoiceToBookInvoice', '--summary'],
      // a flow whose id does not name its ends is renamed in neither mode: a splice, a bridging remove, set target=
      ...[numbered, modeler].flatMap((sample) => [
        ['add', sample, 'userTask', 'Approve invoice', '--after', 'userTask_checkInvoice', '--summary'],
        ['remove', sample, 'serviceTask_bookInvoice', '--json'],
        ['set', sample, sample === numbered ? 'Flow_1' : 'Flow_0k3x9ab', 'target=serviceTask_bookInvoice'],
      ]),
    ];
    for (const args of cases) {
      const plain = ok(...args, '--dry-run').out;
      expect(plain, args.join(' ')).not.toMatch(/flow ids kept/);
      expect(okWith({ BPMN_KEEP_FLOW_IDS: '1' }, ...args, '--dry-run').out, args.join(' ')).toBe(plain);
    }
    for (const env of ['0', 'off', '']) {
      expect(okWith({ BPMN_KEEP_FLOW_IDS: env }, 'add', modelFile, ...splice, '--dry-run').out, env).toBe(ok('add', modelFile, ...splice, '--dry-run').out);
    }
  }, 60000);

  it('an E_NOT_FOUND of a batch says that BPMN_KEEP_FLOW_IDS kept the flow ids: the id the default renames to does not exist', () => {
    const ops = join(dir, 'note-error-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'userTask_checkInvoice' }, { op: 'set', id: 'flow_checkInvoiceToBookInvoice', values: { name: 'ok' } }]));
    const modelFile = fresh('note-error.bpmn');
    expect(ok('apply', modelFile, ops, '--dry-run', '--summary').out).toMatch(/^renamed: flow_checkInvoiceToInvoiceDone -> flow_checkInvoiceToBookInvoice$/m);
    const kept = 'If it is the id a flow an earlier op gave other ends would be renamed to: flow ids are kept here (BPMN_KEEP_FLOW_IDS=1), so that flow kept its old id; use the old id, or --no-keep-flow-ids to rename it after its new ends.';
    let result = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', modelFile, ops, '--dry-run');
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^error E_NOT_FOUND: No element with id "flow_checkInvoiceToBookInvoice" \(did you mean: invoice\?\)\n/);
    expect(result.err).toContain(` to list ids. ${kept}\n`);
    result = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', modelFile, ops, '--dry-run', '--json');
    expect(result.json().error.hint.endsWith(` to list ids. ${kept}`)).toBe(true);
    // a flag decides: the error as without the hint
    const flag = bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'apply', modelFile, ops, '--dry-run', '--keep-flow-ids');
    expect(flag.err).not.toContain('BPMN_KEEP_FLOW_IDS');
    expect(bpmn('apply', modelFile, ops, '--dry-run', '--keep-flow-ids').err).toBe(flag.err);
    // one op: the ids it names are the file's, whatever the mode
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: '1' }, 'set', modelFile, 'Flow_Nowhere', 'name=x').err).not.toContain('BPMN_KEEP_FLOW_IDS');
  });

  it('apply, remove and set target= keep ids too; --strict exits 5 on the warning', () => {
    const ops = join(dir, 'keep-ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'add', kind: 'serviceTask', name: 'Book invoice', after: 'userTask_checkInvoice' }]));
    expect(ok('apply', fresh('keep-apply.bpmn'), ops, '--keep-flow-ids').out).toContain(STALE);
    const bridged = ok('remove', fresh('keep-remove.bpmn'), 'userTask_checkInvoice', '--keep-flow-ids').out;
    expect(bridged).toMatch(/^warning W_FLOW_ID_STALE flow_invoiceReceivedToCheckInvoice: .*`bpmn set <file> flow_invoiceReceivedToCheckInvoice id=flow_invoiceReceivedToInvoiceDone`/m);
    const retargeted = ok('set', fresh('keep-set.bpmn'), 'flow_invoiceReceivedToCheckInvoice', 'target=endEvent_invoiceDone', '--keep-flow-ids').out;
    expect(retargeted).toMatch(/^warning W_FLOW_ID_STALE flow_invoiceReceivedToCheckInvoice: /m);
    const strict = bpmn('add', fresh('keep-strict.bpmn'), ...splice, '--keep-flow-ids', '--strict');
    expect(strict.code).toBe(5);
    expect(strict.out).toContain(STALE);
  });

  it('another BPMN_KEEP_FLOW_IDS value is a usage error of a mutating command (unless a flag decides); show and validate ignore it', () => {
    const modelFile = fresh('env-bad.bpmn');
    const before = readFileSync(modelFile, 'utf8');
    let result = bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', modelFile, ...splice);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^error E_USAGE: BPMN_KEEP_FLOW_IDS=maybe is not a switch value$/m);
    expect(result.err).toMatch(/^ {2}hint: Set BPMN_KEEP_FLOW_IDS=1 \(true, yes, on\) to keep flow ids/m);
    result = bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', modelFile, ...splice, '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.err).error.code).toBe('E_USAGE');
    expect(readFileSync(modelFile, 'utf8')).toBe(before);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'add', modelFile, ...splice, '--keep-flow-ids', '--dry-run').code).toBe(0);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'show', modelFile).code).toBe(0);
    expect(bpmnWith({ BPMN_KEEP_FLOW_IDS: 'maybe' }, 'validate', modelFile).code).toBe(0);
  });
});

/**
 * Regression tests for semantic bugs of the step-1 audit (synthetic fixtures only):
 *  - vendor extension ids (camunda:formField ...) are not BPMN ids
 *  - trigger detail changes keep the existing event definition
 *  - the library path (Doc.fromXml + mutateDoc) refuses lossy imports
 *  - remove / move next to an annotated sequence flow
 *  - retype of a sub-process with content needs --force
 *  - pre-existing validation errors do not block unrelated writes
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { addTo } from '../src/model.js';
import { runOps } from '../src/ops/index.js';
import { mutateDoc, type MutationOptions, type MutationResult } from '../src/pipeline.js';
import type { Op } from '../src/ops/types.js';
import { validateDoc } from '../src/validate.js';
import { elementDetail } from '../src/view.js';
import { definitionsXml } from './helpers.js';

const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

async function rejected(p: Promise<unknown>): Promise<{ code?: string; message: string; details: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected a rejection');
}

async function mutate(xml: string, ops: Op[], opts: MutationOptions = {}): Promise<MutationResult> {
  return mutateDoc(await Doc.fromXml(xml, 'x.bpmn'), ops, { dryRun: true, layout: false, ...opts });
}

function eventDefinitionTags(xml: string): string[] {
  return xml.match(/<bpmn:[a-zA-Z]*EventDefinition[^>]*>/g) ?? [];
}

/* ------------------------------------------------------------------ */
/* 1. vendor extension ids                                              */
/* ------------------------------------------------------------------ */

const FORM_FIELDS = definitionsXml(
  `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_A" name="Enter data">
      <bpmn:extensionElements><camunda:formData><camunda:formField id="email" type="string" /></camunda:formData></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:userTask id="Task_B" name="Check data">
      <bpmn:extensionElements><camunda:formData><camunda:formField id="email" type="string" /></camunda:formData><camunda:properties><camunda:property id="Task_A" name="x" value="y" /></camunda:properties></bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="Task_B" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_B" targetRef="End" />`,
  { nsDecl: CAMUNDA },
);

describe('vendor extension ids are not BPMN ids', () => {
  it('reports no E_DUPLICATE_ID for form fields with the same id in two forms (or a vendor id equal to a BPMN id)', async () => {
    const doc = await Doc.fromXml(FORM_FIELDS);
    expect(doc.importWarnings).toHaveLength(0);
    expect(validateDoc(doc).errors.map((e) => e.code)).not.toContain('E_DUPLICATE_ID');
  });

  it('a write is not blocked and keeps every vendor element untouched', async () => {
    const r = await mutate(FORM_FIELDS, [{ op: 'set', id: 'Task_A', values: { name: 'New name' } }]);
    expect(r.validation.errors).toEqual([]);
    expect(r.xml.match(/<camunda:formField id="email" type="string" \/>/g)).toHaveLength(2);
    expect(r.xml).toContain('<camunda:property id="Task_A" name="x" value="y" />');
    expect(r.xml).toContain('<bpmn:userTask id="Task_A" name="New name">');
  });

  it('the id index resolves BPMN elements only: vendor ids are E_NOT_FOUND (no crash, no edit of extension insides)', async () => {
    const doc = await Doc.fromXml(FORM_FIELDS);
    expect(doc.get('email')).toBeUndefined();
    expect(doc.require('Task_A').$type).toBe('bpmn:UserTask');
    const err = caught(() => doc.require('email'));
    expect(err.code).toBe('E_NOT_FOUND');
    expect(err.message).toMatch(/camunda:formField/);
    expect(err.details.hint).toMatch(/ext list/);
    // show <id> resolves through require: an error, never a crash in readProperties
    expect(caught(() => elementDetail(doc, doc.require('email'))).code).toBe('E_NOT_FOUND');
    for (const op of [
      { op: 'remove', ids: ['email'] },
      { op: 'set', id: 'email', values: { id: 'total' } },
    ] as Op[]) {
      const e = await rejected(mutate(FORM_FIELDS, [op], { force: true }));
      expect(e.code).toBe('E_NOT_FOUND');
    }
  });

  it('a vendor id does not reserve the id for BPMN elements, and real duplicates are still errors', async () => {
    const doc = await Doc.fromXml(FORM_FIELDS);
    runOps(doc, [{ op: 'add', kind: 'task', id: 'email', in: 'Process_1' }]);
    expect(doc.require('email').$type).toBe('bpmn:Task');
    expect(validateDoc(doc).errors.map((e) => e.code)).not.toContain('E_DUPLICATE_ID');
    // removing an element whose extension carries a BPMN element's id keeps that id reserved
    runOps(doc, [{ op: 'remove', ids: ['Task_B'] }]);
    expect(doc.ids.has('Task_A')).toBe(true);
    // a real duplicate among BPMN elements is still an error
    addTo(doc.processes()[0]!, 'flowElements', doc.moddle.create('bpmn:Task', { id: 'Start' }));
    doc.invalidate();
    expect(validateDoc(doc).errors.filter((e) => e.code === 'E_DUPLICATE_ID').map((e) => e.element)).toEqual(['Start']);
  });
});

/* ------------------------------------------------------------------ */
/* 2. trigger details keep the event definition                        */
/* ------------------------------------------------------------------ */

const EVENTS = definitionsXml(
  `
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="C" name="Stock ok"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:conditionalEventDefinition id="CD" camunda:variableName="stock"><bpmn:condition xsi:type="bpmn:tFormalExpression">\${stock &gt; 0}</bpmn:condition></bpmn:conditionalEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="W" name="Wait"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TD"><bpmn:extensionElements><camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle></bpmn:extensionElements><bpmn:timeDuration xsi:type="bpmn:tFormalExpression" id="TD_expr">PT5M</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="E" name="Notify"><bpmn:incoming>F3</bpmn:incoming>
      <bpmn:messageEventDefinition id="MD" messageRef="M1" camunda:type="external" camunda:topic="notify" />
    </bpmn:endEvent>
    <bpmn:endEvent id="X" name="Failed">
      <bpmn:errorEventDefinition id="XD" errorRef="Err1" camunda:errorMessage="boom" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="C" />
    <bpmn:sequenceFlow id="F2" sourceRef="C" targetRef="W" />
    <bpmn:sequenceFlow id="F3" sourceRef="W" targetRef="E" />`,
  { nsDecl: CAMUNDA, extraRoots: '<bpmn:message id="M1" name="Notification" /><bpmn:error id="Err1" name="Failure" errorCode="E1" />' },
);

describe('trigger detail changes keep the event definition', () => {
  it('message: a new message keeps the definition id and its vendor attributes', async () => {
    const r = await mutate(EVENTS, [{ op: 'set', id: 'E', values: { message: 'Notification2' } }]);
    expect(r.changes.warnings).toEqual([]);
    expect(r.xml).toContain('<bpmn:messageEventDefinition id="MD" messageRef="Message_Notification2" camunda:type="external" camunda:topic="notify" />');
  });

  it('conditional: a new condition keeps the definition and its expression element', async () => {
    const r = await mutate(EVENTS, [{ op: 'set', id: 'C', values: { when: '${stock > 10}' } }]);
    expect(r.changes.warnings).toEqual([]);
    expect(eventDefinitionTags(r.xml)).toContain('<bpmn:conditionalEventDefinition id="CD" camunda:variableName="stock">');
    expect(r.xml).toContain('${stock &gt; 10}</bpmn:condition>');
  });

  it('timer: a new value keeps the definition, its extension elements and the expression id; a timer kind change moves the expression', async () => {
    const r = await mutate(EVENTS, [{ op: 'set', id: 'W', values: { timer: 'PT10M' } }]);
    expect(r.xml).toContain('<bpmn:timerEventDefinition id="TD">');
    expect(r.xml).toContain('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle>');
    expect(r.xml).toMatch(/<bpmn:timeDuration xsi:type="bpmn:tFormalExpression" id="TD_expr">PT10M<\/bpmn:timeDuration>/);
    const cycle = await mutate(EVENTS, [{ op: 'set', id: 'W', values: { timer: 'R/PT1H' } }]);
    expect(cycle.xml).toContain('<bpmn:timerEventDefinition id="TD">');
    expect(cycle.xml).toContain('<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle>');
    expect(cycle.xml).toMatch(/<bpmn:timeCycle xsi:type="bpmn:tFormalExpression" id="TD_expr">R\/PT1H<\/bpmn:timeCycle>/);
    expect(cycle.xml).not.toContain('timeDuration');
  });

  it('error: a new error code keeps the definition', async () => {
    const r = await mutate(EVENTS, [{ op: 'set', id: 'X', values: { errorCode: 'E2' } }]);
    expect(r.xml).toContain('<bpmn:errorEventDefinition id="XD" errorRef="Err1" camunda:errorMessage="boom" />');
    expect(r.xml).toContain('<bpmn:error id="Err1" name="Failure" errorCode="E2" />');
  });

  it('retype with options of the same trigger keeps the definition too', async () => {
    const r = await mutate(EVENTS, [{ op: 'retype', id: 'E', kind: 'endEvent:message', message: 'Other' }]);
    expect(r.xml).toContain('<bpmn:messageEventDefinition id="MD" messageRef="Message_Other" camunda:type="external" camunda:topic="notify" />');
  });

  it('a trigger kind change replaces the definition and reports the vendor content it drops', async () => {
    const r = await mutate(EVENTS, [{ op: 'set', id: 'E', values: { trigger: 'signal', signal: 'Go' } }]);
    const w = r.changes.warnings.filter((x) => x.code === 'W_PROPERTY_DROPPED');
    expect(w).toHaveLength(1);
    expect(w[0]!.element).toBe('E');
    expect(w[0]!.message).toMatch(/camunda:type/);
    expect(w[0]!.message).toMatch(/camunda:topic/);
    expect(r.xml).not.toContain('camunda:topic');
    const none = await mutate(EVENTS, [{ op: 'set', id: 'E', values: { trigger: 'none' } }]);
    expect(none.changes.warnings.filter((x) => x.code === 'W_PROPERTY_DROPPED')[0]!.message).toMatch(/camunda:topic/);
    expect(eventDefinitionTags(none.xml).some((t) => t.includes('"MD"'))).toBe(false);
    const ext = await mutate(EVENTS, [{ op: 'set', id: 'W', values: { trigger: 'message', message: 'Wake' } }]);
    expect(ext.changes.warnings.filter((x) => x.code === 'W_PROPERTY_DROPPED')[0]!.message).toMatch(/camunda:failedJobRetryTimeCycle/);
    const retyped = await mutate(EVENTS, [{ op: 'retype', id: 'C', kind: 'intermediateCatchEvent:message', message: 'Stock' }]);
    expect(retyped.changes.warnings.filter((x) => x.code === 'W_PROPERTY_DROPPED')[0]!.message).toMatch(/camunda:variableName/);
  });

  it('a kind change of a definition without vendor content warns about nothing', async () => {
    const doc = Doc.create({ processId: 'P' });
    runOps(doc, [
      { op: 'add', kind: 'startEvent', id: 'S' },
      { op: 'add', kind: 'intermediateCatchEvent:timer', id: 'T', timer: 'PT1M', after: 'S' },
    ]);
    const r = await mutateDoc(doc, [{ op: 'set', id: 'T', values: { trigger: 'message', message: 'M' } }], { dryRun: true, layout: false });
    expect(r.changes.warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. library path: lossy imports                                       */
/* ------------------------------------------------------------------ */

const LOSSY = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_A"><bpmn:incoming>F1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Task_A" />
    <bpmn:fooBar id="Junk_1" />`);

describe('the library path refuses lossy imports like loadDoc', () => {
  it('Doc.fromXml + mutateDoc -> E_IMPORT_LOSSY unless force', async () => {
    const doc = await Doc.fromXml(LOSSY);
    expect(doc.lossyImportWarnings.length).toBeGreaterThan(0);
    const err = await rejected(mutateDoc(doc, [{ op: 'set', id: 'Task_A', values: { name: 'X' } }], { dryRun: true }));
    expect(err.code).toBe('E_IMPORT_LOSSY');
    expect((err.details.warnings as string[]).length).toBeGreaterThan(0);
    const forced = await mutateDoc(await Doc.fromXml(LOSSY), [{ op: 'set', id: 'Task_A', values: { name: 'X' } }], { dryRun: true, force: true });
    expect(forced.importWarnings.length).toBeGreaterThan(0);
    expect(forced.xml).not.toContain('fooBar');
  });
});

/* ------------------------------------------------------------------ */
/* 4. annotated sequence flows next to a removed / moved node           */
/* ------------------------------------------------------------------ */

const ANNOTATED = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="A" />
    <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" />
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="E" />
    <bpmn:textAnnotation id="Note"><bpmn:text>only if paid</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Assoc" sourceRef="Note" targetRef="F2" />`);

describe('remove / move next to an annotated sequence flow', () => {
  it('remove of the node bridges and carries the annotation onto the bridged flow', async () => {
    const r = await mutate(ANNOTATED, [{ op: 'remove', ids: ['A'] }]);
    expect(r.validation.errors).toEqual([]);
    expect(r.xml).toContain('<bpmn:association id="Assoc" sourceRef="Note" targetRef="F1" />');
    expect(r.changes.changed.some((c) => c.id === 'Assoc')).toBe(true);
  });

  it('move of the node out of the annotated flow works the same way', async () => {
    const r = await mutate(ANNOTATED, [{ op: 'move', ids: ['A'], after: 'B' }]);
    expect(r.validation.errors).toEqual([]);
    expect(r.xml).toContain('<bpmn:association id="Assoc" sourceRef="Note" targetRef="F1" />');
  });

  it('without a bridge the association goes with the flow (reported)', async () => {
    const r = await mutate(ANNOTATED, [{ op: 'remove', ids: ['A'], bridge: false }]);
    expect(r.validation.errors).toEqual([]);
    expect(r.xml).not.toContain('bpmn:association');
    expect(r.xml).toContain('id="Note"');
    expect(r.changes.removed.map((c) => c.id)).toContain('Assoc');
  });

  it('a full layout after the remove still works', async () => {
    const r = await mutate(ANNOTATED, [{ op: 'remove', ids: ['A'] }], { layout: 'full' });
    expect(r.layout.status).toBe('ok');
    expect(r.xml).toMatch(/bpmnElement="Assoc"/);
  });
});

/* ------------------------------------------------------------------ */
/* 5. retype of a sub-process with content                              */
/* ------------------------------------------------------------------ */

const WITH_SUB = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub" name="Handle">
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:startEvent id="SubStart"><bpmn:outgoing>SF1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:subProcess id="Inner"><bpmn:incoming>SF1</bpmn:incoming><bpmn:task id="Deep" /></bpmn:subProcess>
      <bpmn:sequenceFlow id="SF1" sourceRef="SubStart" targetRef="Inner" />
    </bpmn:subProcess>
    <bpmn:subProcess id="Empty"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:subProcess>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />
    <bpmn:sequenceFlow id="F2" sourceRef="Sub" targetRef="Empty" />
    <bpmn:sequenceFlow id="F3" sourceRef="Empty" targetRef="E" />`);

describe('retype of a sub-process with content', () => {
  it('is refused with E_WOULD_DROP_CONTENT listing the content, nothing changes', async () => {
    for (const kind of ['task', 'callActivity']) {
      const err = await rejected(mutate(WITH_SUB, [{ op: 'retype', id: 'Sub', kind }]));
      expect(err.code).toBe('E_WOULD_DROP_CONTENT');
      expect(err.details.element).toBe('Sub');
      expect(err.details.related).toEqual(expect.arrayContaining(['SubStart', 'Inner', 'SF1', 'Deep']));
      expect(String(err.details.hint)).toMatch(/--force/);
    }
  });

  it('goes through with --force (content removed and reported) and without content needs no force', async () => {
    const r = await mutate(WITH_SUB, [{ op: 'retype', id: 'Sub', kind: 'task' }], { force: true });
    expect(r.changes.removed.map((c) => c.id)).toEqual(expect.arrayContaining(['SubStart', 'Inner', 'SF1', 'Deep']));
    expect(r.xml).toContain('<bpmn:task id="Sub" name="Handle">');
    const empty = await mutate(WITH_SUB, [{ op: 'retype', id: 'Empty', kind: 'callActivity' }]);
    expect(empty.xml).toContain('<bpmn:callActivity id="Empty">');
  });
});

/* ------------------------------------------------------------------ */
/* 6. pre-existing validation errors                                    */
/* ------------------------------------------------------------------ */

const COMPLEX = definitionsXml(`
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:complexGateway id="Gw"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:complexGateway>
    <bpmn:task id="Task_A"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:subProcess id="Esp" triggeredByEvent="true"><bpmn:startEvent id="EspStart" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Gw" />
    <bpmn:sequenceFlow id="F2" sourceRef="Gw" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_A" targetRef="E" />`);

describe('pre-existing validation errors', () => {
  it('do not block an unrelated write; they are reported as warnings', async () => {
    const doc = await Doc.fromXml(COMPLEX);
    expect(validateDoc(doc).errors.map((e) => e.code).sort()).toEqual(['E_EVENT_SUBPROCESS_PLAIN_START', 'E_UNSUPPORTED_KIND']);
    const r = await mutate(COMPLEX, [{ op: 'set', id: 'Task_A', values: { name: 'Renamed' } }]);
    expect(r.validation.errors).toEqual([]);
    const pre = r.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR');
    expect(pre.map((w) => w.element).sort()).toEqual(['EspStart', 'Gw']);
    expect(pre.find((w) => w.element === 'Gw')!.message).toMatch(/^E_UNSUPPORTED_KIND/);
    expect(r.xml).toContain('<bpmn:task id="Task_A" name="Renamed">');
  });

  it('stay pre-existing when the ops rename or retype the element they are about', async () => {
    const renamed = await mutate(COMPLEX, [{ op: 'set', id: 'EspStart', values: { id: 'EspBegin' } }]);
    expect(renamed.validation.errors).toEqual([]);
    expect(renamed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR').map((w) => w.element).sort()).toEqual(['EspBegin', 'Gw']);
    const fixed = await mutate(COMPLEX, [{ op: 'retype', id: 'Gw', kind: 'exclusiveGateway' }]);
    // the validator's advice works: an unsupported complexGateway can be retyped to a supported gateway
    expect(fixed.validation.warnings.filter((w) => w.code === 'W_PREEXISTING_ERROR').map((w) => w.element)).toEqual(['EspStart']);
    expect(fixed.xml).toMatch(/<bpmn:exclusiveGateway id="Gw">\s*<bpmn:incoming>F1<\/bpmn:incoming>\s*<bpmn:outgoing>F2<\/bpmn:outgoing>/);
  });

  it('errors the ops introduce still block (and --force still overrides)', async () => {
    const ops: Op[] = [{ op: 'add', kind: 'subProcess', id: 'Esp2', in: 'Process_1', set: { triggeredByEvent: 'true' } }];
    const err = await rejected(mutate(COMPLEX, ops));
    expect(err.code).toBe('E_VALIDATION');
    expect((err.details.errors as Array<{ code: string; element?: string }>).map((e) => `${e.code} ${e.element}`)).toEqual(['E_EVENT_SUBPROCESS_NO_START Esp2']);
    const forced = await mutate(COMPLEX, ops, { force: true });
    expect(forced.validation.errors.map((e) => e.element)).toEqual(['Esp2']);
  });
});

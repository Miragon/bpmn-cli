/**
 * Regression tests for the Camunda 7 audit, vendor extension structure and
 * engine-rejected bridges (synthetic fixtures only):
 *  1a. a second single-instance container (camunda:inputOutput, camunda:formData,
 *      camunda:failedJobRetryTimeCycle, camunda:connector, camunda:properties;
 *      zeebe:ioMapping, ...) is merged, or refused with E_DUPLICATE_EXTENSION
 *  1b. child types (camunda:inputParameter, camunda:formField, camunda:property,
 *      zeebe:input, ...) go into their container; the same name replaces
 *  1c. `ext remove` selects one nested item: 'camunda:inputParameter[name=x]'
 *  1d. --xml accepts bpmn: children inside a vendor element (timeout task
 *      listener, camunda:potentialStarter), never at the top level
 *  1e. bpmn:definitions cannot hold extension elements (E_WRONG_KIND)
 *  1f. --xml roots must agree with the positional type
 *  2.  remove does not bridge an event-based gateway to a target the engines
 *      reject (E_INVALID_BRIDGE)
 *  3.  no boundary event on a compensation handler (E_INVALID_HOST);
 *      connect warns about a duplicate flow (W_DUPLICATE_FLOW)
 * The engine behaviour behind each rule was checked on Camunda 7.24, CIB seven
 * 2.2 and Operaton 2.1 (deployment and, for 1b/1c, an external task fetch).
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { is, many, type El } from '../src/model.js';
import { connectElements } from '../src/ops/connect.js';
import { extensionOp, listExtensions, parseSelector, SINGLE_TOP, type ExtensionInfo } from '../src/ops/ext.js';
import { eventGatewayTargetProblem } from '../src/ops/flows.js';
import { runOps } from '../src/ops/index.js';
import { moveElements } from '../src/ops/move.js';
import { removeElements } from '../src/ops/remove.js';
import type { ExtOp, Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';
import { definitionsXml } from './helpers.js';

const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';
const CAMUNDA = `xmlns:camunda="${CAMUNDA_URI}"`;

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

function ext(doc: Doc, op: Omit<ExtOp, 'op'>) {
  return extensionOp(doc, { op: 'ext', ...op } as ExtOp);
}

function add(doc: Doc, id: string, type: string, attrs: Record<string, string> = {}, extra: Partial<ExtOp> = {}) {
  return ext(doc, { id, action: 'add', type, ...(Object.keys(attrs).length ? { attrs } : {}), ...extra });
}

function types(items: Array<Omit<ExtensionInfo, 'index'>> | undefined): string[] {
  return (items ?? []).map((i) => i.type);
}

/** child summaries `type name=value` of the first extension of a type */
function kids(doc: Doc, id: string, type: string): string[] {
  const e = listExtensions(doc.require(id)).find((x) => x.type === type);
  return (e?.children ?? []).map((c) => `${c.type}${Object.entries(c.attrs).map(([k, v]) => ` ${k}=${v}`).join('')}${c.body !== undefined ? ` "${c.body}"` : ''}`);
}

/** start -> external service task -> user task -> end, C7 namespaces declared, through XML like a file on disk. */
async function c7Doc(extra = ''): Promise<Doc> {
  return Doc.fromXml(
    definitionsXml(
      `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Activity_Call" />
    <bpmn:serviceTask id="Activity_Call" name="Call" camunda:type="external" camunda:topic="t"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Call" targetRef="Activity_Approve" />
    <bpmn:userTask id="Activity_Approve" name="Approve"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:userTask>
    <bpmn:sequenceFlow id="F3" sourceRef="Activity_Approve" targetRef="End" />
    <bpmn:endEvent id="End"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>${extra}`,
      { nsDecl: CAMUNDA },
    ),
  );
}

async function reparse(doc: Doc): Promise<Doc> {
  return Doc.fromXml(await doc.toXml());
}

function count(xml: string, tag: string): number {
  return xml.split(`<${tag}`).length - 1;
}

/* ------------------------------------------------------------------ */
/* 1a single-instance containers                                        */
/* ------------------------------------------------------------------ */

describe('ext add: single-instance containers are merged, not duplicated (1a)', () => {
  it('merges a second camunda:inputOutput and camunda:formData (the engines reject two: ENGINE-01009)', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:inputOutput', {}, { xml: '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>' });
    const cs = add(doc, 'Activity_Call', 'camunda:inputOutput', {}, { xml: '<camunda:inputOutput><camunda:inputParameter name="b">2</camunda:inputParameter><camunda:outputParameter name="r">${r}</camunda:outputParameter></camunda:inputOutput>' });
    expect(cs.changed[0]!.detail).toBe('ext merged camunda:inputOutput (added camunda:inputParameter[name=b], added camunda:outputParameter[name=r])');
    add(doc, 'Activity_Approve', 'camunda:formData', {}, { xml: '<camunda:formData><camunda:formField id="f1" type="string"/></camunda:formData>' });
    add(doc, 'Activity_Approve', 'camunda:formData', {}, { xml: '<camunda:formData businessKey="f1"><camunda:formField id="f2" type="long"/></camunda:formData>' });
    const xml = await doc.toXml();
    expect(count(xml, 'camunda:inputOutput>')).toBe(1);
    expect(count(xml, 'camunda:formData')).toBe(1);
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:inputParameter name=a "1"', 'camunda:inputParameter name=b "2"', 'camunda:outputParameter name=r "${r}"']);
    expect(listExtensions(doc.require('Activity_Approve'))).toEqual([
      { index: 0, type: 'camunda:formData', attrs: { businessKey: 'f1' }, children: [{ type: 'camunda:formField', attrs: { id: 'f1', type: 'string' } }, { type: 'camunda:formField', attrs: { id: 'f2', type: 'long' } }] },
    ]);
    // it survives a write and a re-read unchanged
    const again = await reparse(doc);
    expect(listExtensions(again.require('Activity_Call'))).toEqual(listExtensions(doc.require('Activity_Call')));
  });

  it('refuses an ambiguous merge with E_DUPLICATE_EXTENSION (hint --replace); --replace replaces the whole container', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Approve', 'camunda:formData', { businessKey: 'a' });
    const err = caught(() => add(doc, 'Activity_Approve', 'camunda:formData', { businessKey: 'b' }));
    expect(err.code).toBe('E_DUPLICATE_EXTENSION');
    expect(err.message).toMatch(/businessKey="a"/);
    expect(String(err.details['hint'])).toMatch(/--replace/);
    add(doc, 'Activity_Call', 'camunda:failedJobRetryTimeCycle', {}, { body: 'R3/PT5M' });
    // the same content again: nothing to do, nothing reported as changed
    const same = add(doc, 'Activity_Call', 'camunda:failedJobRetryTimeCycle', {}, { body: 'R3/PT5M' });
    expect(same.changed).toEqual([]);
    expect(same.notes.join(' ')).toMatch(/already holds that content/);
    expect(caught(() => add(doc, 'Activity_Call', 'camunda:failedJobRetryTimeCycle', {}, { body: 'R5/PT1M' })).code).toBe('E_DUPLICATE_EXTENSION');
    add(doc, 'Activity_Call', 'camunda:failedJobRetryTimeCycle', {}, { body: 'R5/PT1M', replace: true });
    expect(listExtensions(doc.require('Activity_Call'))).toEqual([{ index: 0, type: 'camunda:failedJobRetryTimeCycle', attrs: {}, body: 'R5/PT1M' }]);
    // non-conflicting attributes merge
    add(doc, 'Activity_Approve', 'camunda:formData', {}, { xml: '<camunda:formData businessKey="a"><camunda:formField id="x" type="string"/></camunda:formData>' });
    expect(kids(doc, 'Activity_Approve', 'camunda:formData')).toEqual(['camunda:formField id=x type=string']);
  });

  it('refuses to add into a file that already holds two of a single-instance container', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(
        `<bpmn:serviceTask id="T" camunda:expression="\${true}"><bpmn:extensionElements>
          <camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>
          <camunda:inputOutput><camunda:inputParameter name="b">2</camunda:inputParameter></camunda:inputOutput>
        </bpmn:extensionElements></bpmn:serviceTask>`,
        { nsDecl: CAMUNDA },
      ),
    );
    const err = caught(() => add(doc, 'T', 'camunda:inputParameter', { name: 'c' }, { body: '3' }));
    expect(err.code).toBe('E_DUPLICATE_EXTENSION');
    expect(String(err.details['hint'])).toMatch(/camunda:inputOutput .*--replace/);
    // --replace with the whole container repairs the file
    add(doc, 'T', 'camunda:inputOutput', {}, { xml: '<camunda:inputOutput><camunda:inputParameter name="c">3</camunda:inputParameter></camunda:inputOutput>', replace: true });
    expect(types(listExtensions(doc.require('T')))).toEqual(['camunda:inputOutput']);
  });

  it('merges a second camunda:properties and Zeebe containers; a conflicting zeebe:taskDefinition is refused', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:properties', {}, { xml: '<camunda:properties><camunda:property name="a" value="1"/></camunda:properties>' });
    add(doc, 'Activity_Call', 'camunda:properties', {}, { xml: '<camunda:properties><camunda:property name="b" value="2"/></camunda:properties>' });
    expect(types(listExtensions(doc.require('Activity_Call')))).toEqual(['camunda:properties']);
    add(doc, 'Activity_Approve', 'zeebe:ioMapping', {}, { xml: '<zeebe:ioMapping><zeebe:input source="=a" target="a"/></zeebe:ioMapping>' });
    add(doc, 'Activity_Approve', 'zeebe:ioMapping', {}, { xml: '<zeebe:ioMapping><zeebe:output source="=b" target="b"/></zeebe:ioMapping>' });
    add(doc, 'Activity_Approve', 'zeebe:taskDefinition', { type: 'x' });
    add(doc, 'Activity_Approve', 'zeebe:taskDefinition', { retries: '3' });
    expect(listExtensions(doc.require('Activity_Approve')).map((e) => [e.type, e.attrs, types(e.children)])).toEqual([
      ['zeebe:ioMapping', {}, ['zeebe:input', 'zeebe:output']],
      ['zeebe:taskDefinition', { type: 'x', retries: '3' }, []],
    ]);
    expect(caught(() => add(doc, 'Activity_Approve', 'zeebe:taskDefinition', { type: 'y' })).code).toBe('E_DUPLICATE_EXTENSION');
  });

  it('documents the single-instance list (engine-verified for camunda)', () => {
    for (const t of ['camunda:inputOutput', 'camunda:formData', 'camunda:connector', 'camunda:failedJobRetryTimeCycle', 'camunda:properties', 'zeebe:ioMapping', 'zeebe:taskDefinition']) {
      expect(SINGLE_TOP.has(t)).toBe(true);
    }
    // repeatable ones stay repeatable (the engines accept several)
    for (const t of ['camunda:executionListener', 'camunda:taskListener', 'camunda:in', 'camunda:out', 'camunda:field', 'camunda:potentialStarter', 'camunda:errorEventDefinition', 'camunda:formProperty']) {
      expect(SINGLE_TOP.has(t)).toBe(false);
    }
  });

  it('keeps repeatable types repeatable (two execution listeners)', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:executionListener', { event: 'start', expression: '${a}' });
    add(doc, 'Activity_Call', 'camunda:executionListener', { event: 'start', expression: '${b}' });
    expect(types(listExtensions(doc.require('Activity_Call')))).toEqual(['camunda:executionListener', 'camunda:executionListener']);
  });
});

/* ------------------------------------------------------------------ */
/* 1b child types                                                       */
/* ------------------------------------------------------------------ */

describe('ext add: child types go into their container (1b)', () => {
  it('puts camunda:inputParameter / outputParameter into camunda:inputOutput (created), inputs before outputs', async () => {
    const doc = await c7Doc();
    const cs = add(doc, 'Activity_Call', 'camunda:outputParameter', { name: 'result' }, { body: '${r}' });
    expect(cs.changed[0]!.detail).toBe('ext added camunda:outputParameter[name=result] to camunda:inputOutput');
    expect(cs.notes).toContain('created camunda:inputOutput for camunda:outputParameter');
    add(doc, 'Activity_Call', 'camunda:inputParameter', { name: 'customerId' }, { body: '${customerId}' });
    expect(listExtensions(doc.require('Activity_Call'))).toEqual([
      {
        index: 0,
        type: 'camunda:inputOutput',
        attrs: {},
        children: [
          { type: 'camunda:inputParameter', attrs: { name: 'customerId' }, body: '${customerId}' },
          { type: 'camunda:outputParameter', attrs: { name: 'result' }, body: '${r}' },
        ],
      },
    ]);
    expect(await doc.toXml()).toMatch(/<camunda:inputOutput>\s*<camunda:inputParameter name="customerId">\$\{customerId\}<\/camunda:inputParameter>\s*<camunda:outputParameter name="result">/);
  });

  it('replaces a parameter with the same name in place and reports it', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:inputParameter', { name: 'a' }, { body: '1' });
    add(doc, 'Activity_Call', 'camunda:inputParameter', { name: 'amount' }, { body: '${amount}' });
    const cs = add(doc, 'Activity_Call', 'camunda:inputParameter', { name: 'amount' }, { body: '${amount * 2}' });
    expect(cs.changed[0]!.detail).toBe('ext replaced camunda:inputParameter[name=amount] in camunda:inputOutput');
    expect(cs.notes.join(' ')).toMatch(/replaced the existing camunda:inputParameter\[name=amount\]/);
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:inputParameter name=a "1"', 'camunda:inputParameter name=amount "${amount * 2}"']);
    // merging a container with a parameter of the same name replaces that parameter too
    add(doc, 'Activity_Call', 'camunda:inputOutput', {}, { xml: '<camunda:inputOutput><camunda:inputParameter name="a">2</camunda:inputParameter></camunda:inputOutput>' });
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:inputParameter name=a "2"', 'camunda:inputParameter name=amount "${amount * 2}"']);
  });

  it('puts camunda:formField, camunda:property and camunda:connectorId into their containers; Zeebe children too', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Approve', 'camunda:formField', { id: 'amount', type: 'long' });
    add(doc, 'Activity_Approve', 'camunda:formField', { id: 'note', type: 'string' });
    add(doc, 'Activity_Approve', 'camunda:property', { name: 'k', value: 'v' });
    add(doc, 'Activity_Call', 'camunda:connectorId', {}, { body: 'http-connector' });
    add(doc, 'Activity_Call', 'zeebe:input', { source: '=a', target: 'a' });
    add(doc, 'Activity_Call', 'zeebe:header', { key: 'k', value: 'v' });
    expect(listExtensions(doc.require('Activity_Approve')).map((e) => [e.type, types(e.children)])).toEqual([
      ['camunda:formData', ['camunda:formField', 'camunda:formField']],
      ['camunda:properties', ['camunda:property']],
    ]);
    expect(listExtensions(doc.require('Activity_Call')).map((e) => [e.type, types(e.children)])).toEqual([
      ['camunda:connector', ['camunda:connectorId']],
      ['zeebe:ioMapping', ['zeebe:input']],
      ['zeebe:taskHeaders', ['zeebe:header']],
    ]);
    expect(doc.definitions.$attrs['xmlns:zeebe']).toBe(ZEEBE_URI);
  });

  it('follows a path: the connector gets its own camunda:inputOutput, a form field its validation', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:connectorId', {}, { body: 'http-connector' });
    add(doc, 'Activity_Call', 'camunda:connector/camunda:inputParameter', { name: 'url' }, { body: 'https://example.org' });
    add(doc, 'Activity_Call', 'camunda:inputParameter', { name: 'own' }, { body: '1' });
    const [connector, io] = listExtensions(doc.require('Activity_Call'));
    expect(connector).toMatchObject({ type: 'camunda:connector' });
    // the modeler's order: inputOutput before connectorId
    expect(connector!.children!.map((c) => [c.type, types(c.children)])).toEqual([
      ['camunda:inputOutput', ['camunda:inputParameter']],
      ['camunda:connectorId', []],
    ]);
    expect(io).toMatchObject({ type: 'camunda:inputOutput', children: [{ attrs: { name: 'own' } }] });

    add(doc, 'Activity_Approve', 'camunda:formField', { id: 'amount', type: 'long' });
    const cs = add(doc, 'Activity_Approve', 'camunda:formField[id=amount]/camunda:validation/camunda:constraint', { name: 'min', config: '1' });
    expect(cs.changed[0]!.detail).toBe('ext added camunda:validation to camunda:formField[id=amount], camunda:constraint[name=min] to camunda:validation');
    add(doc, 'Activity_Approve', 'camunda:formField[id=amount]/camunda:property', { id: 'p1', value: 'x' });
    expect(listExtensions(doc.require('Activity_Approve'))[0]!.children![0]!.children!.map((c) => [c.type, types(c.children)])).toEqual([
      ['camunda:properties', ['camunda:property']],
      ['camunda:validation', ['camunda:constraint']],
    ]);
    // a predicate on a missing container is an error, an ambiguous one too
    expect(caught(() => add(doc, 'Activity_Approve', 'camunda:formField[id=nope]/camunda:validation', {})).code).toBe('E_NO_EXTENSION');
    add(doc, 'Activity_Approve', 'camunda:taskListener', { event: 'create', expression: '${a}' });
    add(doc, 'Activity_Approve', 'camunda:taskListener', { event: 'create', expression: '${b}' });
    expect(caught(() => add(doc, 'Activity_Approve', 'camunda:taskListener/camunda:field', { name: 'f' })).code).toBe('E_AMBIGUOUS_EXTENSION');
    add(doc, 'Activity_Approve', 'camunda:taskListener[1]/camunda:field', { name: 'f', stringValue: 'v' });
    expect(listExtensions(doc.require('Activity_Approve')).filter((e) => e.type === 'camunda:taskListener').map((e) => types(e.children))).toEqual([[], ['camunda:field']]);
    // only attribute-free containers are created on the way; a listener or form field must exist first
    const missing = caught(() => add(doc, 'Activity_Call', 'camunda:executionListener/camunda:field', { name: 'f' }));
    expect(missing.code).toBe('E_NO_EXTENSION');
    expect(String(missing.details['hint'])).toMatch(/Add the camunda:executionListener itself first/);
    // --replace reaches into the container: a single child is replaced, not refused
    expect(caught(() => add(doc, 'Activity_Call', 'camunda:connectorId', {}, { body: 'soap-http-connector' })).code).toBe('E_DUPLICATE_EXTENSION');
    add(doc, 'Activity_Call', 'camunda:connectorId', {}, { body: 'soap-http-connector', replace: true });
    expect(listExtensions(doc.require('Activity_Call'))[0]!.children!.map((c) => [c.type, c.body])).toEqual([
      ['camunda:inputOutput', undefined],
      ['camunda:connectorId', 'soap-http-connector'],
    ]);
  });

  it('uses the prefix the file binds to the camunda namespace (no second prefix)', async () => {
    const doc = await Doc.fromXml(
      definitionsXml(`<bpmn:userTask id="U"><bpmn:extensionElements><cam:inputOutput><cam:inputParameter name="a">1</cam:inputParameter></cam:inputOutput></bpmn:extensionElements></bpmn:userTask>`, {
        nsDecl: `xmlns:cam="${CAMUNDA_URI}"`,
      }),
    );
    add(doc, 'U', 'camunda:inputParameter', { name: 'b' }, { body: '2' });
    expect(kids(doc, 'U', 'cam:inputOutput')).toEqual(['cam:inputParameter name=a "1"', 'cam:inputParameter name=b "2"']);
    expect(doc.definitions.$attrs['xmlns:camunda']).toBeUndefined();
    const xml = await doc.toXml();
    expect(xml).toContain('<cam:inputParameter name="b">2</cam:inputParameter>');
    expect(xml).not.toContain('xmlns:camunda');
    expect(count(xml, 'cam:inputOutput>')).toBe(1);
  });

  it('warns W_MISPLACED_EXTENSION for content the engines do not read where it is put', async () => {
    const doc = await c7Doc();
    const loose = add(doc, 'Activity_Approve', 'camunda:constraint', { name: 'required' });
    expect(loose.warnings.map((w) => w.code)).toEqual(['W_MISPLACED_EXTENSION']);
    expect(loose.warnings[0]!.hint).toContain("'camunda:formField[id=<id>]/camunda:validation/camunda:constraint'");
    const field = add(doc, 'Activity_Approve', 'camunda:field', { name: 'f', stringValue: 'v' });
    expect(field.warnings.map((w) => w.code)).toEqual(['W_MISPLACED_EXTENSION']);
    expect(add(doc, 'Activity_Call', 'camunda:field', { name: 'f', stringValue: 'v' }).warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 1c remove one nested item                                            */
/* ------------------------------------------------------------------ */

describe('ext remove: one nested item by selector (1c)', () => {
  async function withParams(): Promise<Doc> {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:inputOutput', {}, {
      xml: '<camunda:inputOutput><camunda:inputParameter name="customerId">${c}</camunda:inputParameter><camunda:inputParameter name="draft">x</camunda:inputParameter><camunda:outputParameter name="r">${r}</camunda:outputParameter></camunda:inputOutput>',
    });
    add(doc, 'Activity_Call', 'camunda:failedJobRetryTimeCycle', {}, { body: 'R3/PT5M' });
    return doc;
  }

  it("removes 'camunda:inputParameter[name=draft]' only", async () => {
    const doc = await withParams();
    const cs = ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:inputParameter[name=draft]' });
    expect(cs.changed[0]!.detail).toBe('ext removed camunda:inputParameter[name=draft] from camunda:inputOutput');
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:inputParameter name=customerId "${c}"', 'camunda:outputParameter name=r "${r}"']);
  });

  it('removes a container left empty, and extensionElements when nothing is left', async () => {
    const doc = await withParams();
    ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:inputParameter' });
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:outputParameter name=r "${r}"']);
    const cs = ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:outputParameter[0]' });
    expect(cs.notes).toContain('removed the empty camunda:inputOutput of Activity_Call');
    expect(types(listExtensions(doc.require('Activity_Call')))).toEqual(['camunda:failedJobRetryTimeCycle']);
    ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:failedJobRetryTimeCycle' });
    expect(doc.require('Activity_Call').get('extensionElements')).toBeUndefined();
    expect(await doc.toXml()).not.toMatch(/<bpmn:serviceTask[^>]*>\s*<bpmn:extensionElements/);
  });

  it('selects by path, by index and by a predicate found deeper; lists keyed candidates when nothing matches', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Approve', 'camunda:formField', { id: 'amount', type: 'long' });
    add(doc, 'Activity_Approve', 'camunda:formField', { id: 'note', type: 'string' });
    add(doc, 'Activity_Approve', 'camunda:formField[id=amount]/camunda:validation/camunda:constraint', { name: 'min', config: '1' });
    add(doc, 'Activity_Approve', 'camunda:formField[id=amount]/camunda:validation/camunda:constraint', { name: 'max', config: '9' });
    ext(doc, { id: 'Activity_Approve', action: 'remove', type: 'camunda:constraint[name=min]' });
    ext(doc, { id: 'Activity_Approve', action: 'remove', type: "camunda:formField[id='amount']/camunda:validation/camunda:constraint[name=\"max\"]" });
    expect(listExtensions(doc.require('Activity_Approve'))[0]!.children!.map((c) => [c.attrs['id'], types(c.children)])).toEqual([
      ['amount', []],
      ['note', []],
    ]);
    ext(doc, { id: 'Activity_Approve', action: 'remove', type: 'camunda:formField[1]' });
    expect(kids(doc, 'Activity_Approve', 'camunda:formData')).toEqual(['camunda:formField id=amount type=long']);
    const err = caught(() => ext(doc, { id: 'Activity_Approve', action: 'remove', type: 'camunda:formField[id=nope]' }));
    expect(err.code).toBe('E_NO_EXTENSION');
    expect(err.details['candidates']).toContain('camunda:formField[id=amount]');
    expect(caught(() => ext(doc, { id: 'Activity_Approve', action: 'remove', type: 'camunda:formField[id=amount' })).code).toBe('E_INVALID_VALUE');
  });

  it('refuses a predicate that matches items in several places and names their paths', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Call', 'camunda:executionListener', { event: 'start', class: 'a.B' });
    add(doc, 'Activity_Call', 'camunda:executionListener', { event: 'end', class: 'a.B' });
    add(doc, 'Activity_Call', 'camunda:executionListener[0]/camunda:field', { name: 'x', stringValue: '1' });
    add(doc, 'Activity_Call', 'camunda:executionListener[1]/camunda:field', { name: 'x', stringValue: '2' });
    const err = caught(() => ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:field[name=x]' }));
    expect(err.code).toBe('E_AMBIGUOUS_EXTENSION');
    expect(err.details['candidates']).toEqual(['camunda:executionListener[0]/camunda:field[name=x]', 'camunda:executionListener[1]/camunda:field[name=x]']);
    ext(doc, { id: 'Activity_Call', action: 'remove', type: 'camunda:executionListener[1]/camunda:field[name=x]' });
    expect(listExtensions(doc.require('Activity_Call')).map((e) => types(e.children))).toEqual([['camunda:field'], []]);
  });

  it('parses selectors', async () => {
    const doc = await c7Doc();
    const el = doc.require('Activity_Call');
    expect(parseSelector("a:b[name='x/y']/c:d[2]", el)).toEqual([
      { name: 'a:b', attr: 'name', value: 'x/y', text: "a:b[name='x/y']" },
      { name: 'c:d', index: 2, text: 'c:d[2]' },
    ]);
    expect(caught(() => parseSelector('a:b//c:d', el)).code).toBe('E_INVALID_VALUE');
    expect(caught(() => parseSelector('a:b[]', el)).code).toBe('E_INVALID_VALUE');
  });
});

/* ------------------------------------------------------------------ */
/* 1d bpmn: children inside vendor elements                             */
/* ------------------------------------------------------------------ */

describe('ext add --xml: bpmn: children inside a vendor element (1d)', () => {
  const TIMEOUT =
    '<camunda:taskListener event="timeout" id="TO1" expression="${true}"><bpmn:timerEventDefinition id="TimerEventDefinition_TO1"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></camunda:taskListener>';

  it('accepts a timeout task listener and a potential starter, exactly as moddle parses them', async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Approve', 'camunda:taskListener', {}, { xml: TIMEOUT });
    add(doc, 'Process_1', 'camunda:potentialStarter', {}, {
      xml: '<camunda:potentialStarter><bpmn:resourceAssignmentExpression><bpmn:formalExpression>group2, user(kermit)</bpmn:formalExpression></bpmn:resourceAssignmentExpression></camunda:potentialStarter>',
    });
    const xml = await doc.toXml();
    expect(xml).toMatch(/<camunda:taskListener event="timeout" id="TO1" expression="\$\{true\}">\s*<bpmn:timerEventDefinition id="TimerEventDefinition_TO1">\s*<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H<\/bpmn:timeDuration>/);
    expect(xml).toMatch(/<camunda:potentialStarter>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>group2, user\(kermit\)<\/bpmn:formalExpression>/);
    // the timer definition is vendor content: not a BPMN id
    expect(doc.get('TimerEventDefinition_TO1')).toBeUndefined();
    const again = await reparse(doc);
    expect(listExtensions(again.require('Activity_Approve'))).toEqual(listExtensions(doc.require('Activity_Approve')));
    expect(again.importWarnings).toEqual([]);
    // what moddle itself builds from the same snippet
    const wrapped = `<bpmn:extensionElements xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${CAMUNDA}>${TIMEOUT}</bpmn:extensionElements>`;
    const parsed = await doc.moddle.fromXML(wrapped, 'bpmn:ExtensionElements');
    const holder = doc.moddle.create('bpmn:Task', { id: 'Tmp', extensionElements: parsed.rootElement });
    expect(listExtensions(holder)).toEqual(listExtensions(doc.require('Activity_Approve')));
  });

  it('still refuses a bpmn: element at the top level of extensionElements', async () => {
    const doc = await c7Doc();
    expect(caught(() => add(doc, 'Activity_Call', 'bpmn:timerEventDefinition', {}, { xml: '<bpmn:timerEventDefinition/>' })).code).toBe('E_INVALID_VALUE');
    expect(caught(() => add(doc, 'Activity_Call', 'b:documentation', {}, { xml: '<b:documentation xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL">x</b:documentation>' })).code).toBe('E_INVALID_VALUE');
    expect(doc.require('Activity_Call').get('extensionElements')).toBeUndefined();
    // inside a vendor element through a path it is fine
    add(doc, 'Activity_Approve', 'camunda:taskListener', { event: 'timeout', id: 'TO2', expression: '${true}' });
    add(doc, 'Activity_Approve', 'camunda:taskListener[id=TO2]/bpmn:timerEventDefinition', {}, { xml: '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT2H</bpmn:timeDuration></bpmn:timerEventDefinition>' });
    expect(listExtensions(doc.require('Activity_Approve'))[0]!.children!.map((c) => c.type)).toEqual(['bpmn:timerEventDefinition']);
  });

  it("maps an aliased BPMN prefix to the file's own prefix instead of declaring a second one", async () => {
    const doc = await c7Doc();
    add(doc, 'Activity_Approve', 'camunda:taskListener', {}, { xml: '<camunda:taskListener xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" event="create" expression="${true}"><b:documentation>x</b:documentation></camunda:taskListener>' });
    const xml = await doc.toXml();
    expect(xml).toContain('<bpmn:documentation>x</bpmn:documentation>');
    expect(xml).not.toMatch(/xmlns:b=|<b:/);
    expect(xml).toMatch(/^<\?xml[^>]*>\s*<bpmn:definitions /);
  });

  it('writes the BPMN prefix the file uses (bpmn2:, or none for a default namespace)', async () => {
    const bpmn2 = await Doc.fromXml(
      `<?xml version="1.0" encoding="UTF-8"?><bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${CAMUNDA} id="D" targetNamespace="x"><bpmn2:process id="P"><bpmn2:userTask id="U"/></bpmn2:process></bpmn2:definitions>`,
    );
    add(bpmn2, 'U', 'camunda:taskListener', {}, { xml: TIMEOUT });
    expect(await bpmn2.toXml()).toContain('<bpmn2:timeDuration xsi:type="bpmn2:tFormalExpression">PT1H</bpmn2:timeDuration>');
    const dflt = await Doc.fromXml(
      `<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${CAMUNDA} id="D" targetNamespace="x"><process id="P"><userTask id="U"/></process></definitions>`,
    );
    add(dflt, 'U', 'camunda:taskListener', {}, { xml: TIMEOUT });
    const xml = await dflt.toXml();
    expect(xml).toContain('<timeDuration xsi:type="tFormalExpression">PT1H</timeDuration>');
    expect(xml).not.toContain('bpmn:');
  });
});

/* ------------------------------------------------------------------ */
/* 1e / 1f                                                              */
/* ------------------------------------------------------------------ */

describe('ext add: where and what (1e, 1f)', () => {
  it('refuses extension elements on bpmn:definitions (XSD-invalid, engines reject it)', async () => {
    const doc = await c7Doc();
    const err = caught(() => add(doc, 'Definitions_1', 'camunda:properties', {}, { xml: '<camunda:properties><camunda:property name="a" value="b"/></camunda:properties>' }));
    expect(err.code).toBe('E_WRONG_KIND');
    expect(String(err.details['hint'])).toMatch(/process/);
    expect(doc.definitions.get('extensionElements')).toBeUndefined();
    // the pipeline writes nothing
    await expect(mutateDoc(doc, [{ op: 'ext', id: 'Definitions_1', action: 'add', type: 'camunda:property', attrs: { name: 'a' } }], { dryRun: true, layout: false })).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });

  it('checks that the positional type agrees with the --xml roots', async () => {
    const doc = await c7Doc();
    const err = caught(() => add(doc, 'Activity_Call', 'camunda:field', {}, { xml: '<camunda:inputOutput><camunda:inputParameter name="b">2</camunda:inputParameter></camunda:inputOutput>' }));
    expect(err.code).toBe('E_INVALID_VALUE');
    expect(err.message).toMatch(/<camunda:inputOutput> does not match the type camunda:field/);
    expect(doc.require('Activity_Call').get('extensionElements')).toBeUndefined();
    // a failing snippet leaves no half-built path behind
    expect(caught(() => add(doc, 'Activity_Call', 'camunda:connector/camunda:inputParameter', {}, { xml: '<camunda:inputParameter name="x">' })).code).toBe('E_INVALID_XML');
    expect(caught(() => add(doc, 'Activity_Call', 'camunda:connector/camunda:inputParameter', {}, { xml: '<camunda:outputParameter name="x"/>' })).code).toBe('E_INVALID_VALUE');
    expect(doc.require('Activity_Call').get('extensionElements')).toBeUndefined();
    // a path type: the last step names the roots, the steps before the container
    add(doc, 'Activity_Call', 'camunda:inputOutput/camunda:inputParameter', {}, { xml: '<camunda:inputParameter name="x"><camunda:list><camunda:value>a</camunda:value></camunda:list></camunda:inputParameter>' });
    expect(kids(doc, 'Activity_Call', 'camunda:inputOutput')).toEqual(['camunda:inputParameter name=x']);
    // without a type (ops JSON) every root is taken as it is
    ext(doc, { id: 'Activity_Call', action: 'add', xml: '<camunda:properties/><camunda:executionListener event="end" expression="${x}"/>' });
    expect(types(listExtensions(doc.require('Activity_Call')))).toEqual(['camunda:inputOutput', 'camunda:properties', 'camunda:executionListener']);
    expect(caught(() => add(doc, 'Activity_Call', 'camunda:inputOutput', { a: 'b' }, { xml: '<camunda:inputOutput/>' })).code).toBe('E_USAGE');
  });
});

/* ------------------------------------------------------------------ */
/* 2 bridging next to an event-based gateway                            */
/* ------------------------------------------------------------------ */

const MSG_ROOTS = `<bpmn:message id="Message_Paid" name="Paid" /><bpmn:message id="Message_Finished" name="Finished" /><bpmn:message id="Message_Finished2" name="Finished" /><bpmn:message id="Message_Confirmed" name="Confirmed" /><bpmn:signal id="Signal_Go" name="Go" />`;

/** Fills incoming / outgoing of the flow nodes from the sequence flows (what modeler files carry; Doc.fromXml completes them in memory already). */
function withMirrors(doc: Doc): Doc {
  for (const f of many(doc.require('Process_1'), 'flowElements')) {
    if (!is(f, 'bpmn:SequenceFlow')) continue;
    for (const [end, list] of [['sourceRef', 'outgoing'], ['targetRef', 'incoming']] as const) {
      const entries = many(f.get<El>(end), list);
      if (!entries.includes(f)) entries.push(f);
    }
  }
  return doc;
}

/** Start -> Gateway_Wait -> [A ...] and -> Event_Timeout -> End_T; `branch` is the XML of the A branch (ending in End_A). */
async function gatewayDoc(branch: string, more = ''): Promise<Doc> {
  const doc = await Doc.fromXml(
    definitionsXml(
      `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F0" sourceRef="Start" targetRef="Gateway_Wait" />
    <bpmn:eventBasedGateway id="Gateway_Wait" />
    ${branch}
    <bpmn:sequenceFlow id="F_T" sourceRef="Gateway_Wait" targetRef="Event_Timeout" />
    <bpmn:intermediateCatchEvent id="Event_Timeout"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_T2" sourceRef="Event_Timeout" targetRef="End_T" />
    <bpmn:endEvent id="End_T" />${more}`,
      { nsDecl: CAMUNDA, extraRoots: MSG_ROOTS },
    ),
  );
  return withMirrors(doc);
}

const catchMsg = (id: string, ref: string) => `<bpmn:intermediateCatchEvent id="${id}"><bpmn:messageEventDefinition messageRef="${ref}" /></bpmn:intermediateCatchEvent>`;

describe('remove: no bridge from an event-based gateway to a target the engines reject (2)', () => {
  it('refuses to bridge the gateway to an end event (E_INVALID_BRIDGE), nothing changes', async () => {
    const doc = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    const err = caught(() => removeElements(doc, { op: 'remove', ids: ['Event_Paid'] }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.message).toMatch(/Gateway_Wait to End_A/);
    expect(String(err.details['hint'])).toMatch(/--no-bridge/);
    expect(doc.get('Event_Paid')).toBeDefined();
    // the pipeline refuses as well
    await expect(mutateDoc(doc, [{ op: 'remove', ids: ['Event_Paid'] }], { dryRun: true, layout: false })).rejects.toMatchObject({ code: 'E_INVALID_BRIDGE' });
    // --no-bridge and removing the whole branch work
    const nb = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    removeElements(nb, { op: 'remove', ids: ['Event_Paid'], bridge: false });
    expect(nb.outgoing(nb.require('Gateway_Wait')).map((f) => f.get<El>('targetRef').get('id'))).toEqual(['Event_Timeout']);
    const both = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    removeElements(both, { op: 'remove', ids: ['Event_Paid', 'End_A'] });
    expect(both.outgoing(both.require('Gateway_Wait')).map((f) => f.get<El>('targetRef').get('id'))).toEqual(['Event_Timeout']);
  });

  it('refuses a bridge that makes two branches wait for the same message name', async () => {
    const doc = await gatewayDoc(
      `
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Received" />${catchMsg('Event_Received', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Received" targetRef="Event_FinishedA" />${catchMsg('Event_FinishedA', 'Message_Finished')}
    <bpmn:sequenceFlow id="F_A3" sourceRef="Event_FinishedA" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`,
      `
    <bpmn:sequenceFlow id="F_B" sourceRef="Gateway_Wait" targetRef="Event_FinishedB" />${catchMsg('Event_FinishedB', 'Message_Finished2')}
    <bpmn:sequenceFlow id="F_B2" sourceRef="Event_FinishedB" targetRef="End_B" />
    <bpmn:endEvent id="End_B" />`,
    );
    const err = caught(() => removeElements(doc, { op: 'remove', ids: ['Event_Received'] }));
    expect(err.code).toBe('E_INVALID_BRIDGE');
    expect(err.message).toMatch(/Event_FinishedB .* already waits for the message "Finished"/);
  });

  it('refuses receive tasks, catch events with another incoming flow and duplicate signals; allows a distinct message', async () => {
    const receive = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="Task_Receive" />
    <bpmn:receiveTask id="Task_Receive" messageRef="Message_Confirmed" />
    <bpmn:sequenceFlow id="F_A3" sourceRef="Task_Receive" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    expect(caught(() => removeElements(receive, { op: 'remove', ids: ['Event_Paid'] })).message).toMatch(/Task_Receive.* is not an intermediate catch event/);

    const joined = await gatewayDoc(
      `
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="Event_Confirmed" />${catchMsg('Event_Confirmed', 'Message_Confirmed')}
    <bpmn:sequenceFlow id="F_A3" sourceRef="Event_Confirmed" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`,
      `<bpmn:sequenceFlow id="F_X" sourceRef="End_T_Pre" targetRef="Event_Confirmed" /><bpmn:task id="End_T_Pre" />`,
    );
    expect(caught(() => removeElements(joined, { op: 'remove', ids: ['Event_Paid'] })).message).toMatch(/already has the incoming flow F_X/);

    const signals = await gatewayDoc(
      `
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="Event_Go" />
    <bpmn:intermediateCatchEvent id="Event_Go"><bpmn:signalEventDefinition signalRef="Signal_Go" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_A3" sourceRef="Event_Go" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`,
      `
    <bpmn:sequenceFlow id="F_B" sourceRef="Gateway_Wait" targetRef="Event_Go2" />
    <bpmn:intermediateCatchEvent id="Event_Go2"><bpmn:signalEventDefinition signalRef="Signal_Go" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F_B2" sourceRef="Event_Go2" targetRef="End_B" />
    <bpmn:endEvent id="End_B" />`,
    );
    expect(caught(() => removeElements(signals, { op: 'remove', ids: ['Event_Paid'] })).message).toMatch(/waits for the signal "Go"/);

    const ok = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="Event_Confirmed" />${catchMsg('Event_Confirmed', 'Message_Confirmed')}
    <bpmn:sequenceFlow id="F_A3" sourceRef="Event_Confirmed" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    const cs = removeElements(ok, { op: 'remove', ids: ['Event_Paid'] });
    expect(cs.notes).toContain('bridged: Gateway_Wait -> Event_Confirmed');
    const r = await mutateDoc(ok, [], { dryRun: true, layout: false });
    expect(r.validation.errors).toEqual([]);
  });

  it('applies to move as well (it bridges the old place the same way)', async () => {
    const doc = await gatewayDoc(`
    <bpmn:sequenceFlow id="F_A" sourceRef="Gateway_Wait" targetRef="Event_Paid" />${catchMsg('Event_Paid', 'Message_Paid')}
    <bpmn:sequenceFlow id="F_A2" sourceRef="Event_Paid" targetRef="End_A" />
    <bpmn:endEvent id="End_A" />`);
    expect(caught(() => moveElements(doc, { op: 'move', ids: ['Event_Paid'], after: 'Event_Timeout' })).code).toBe('E_INVALID_BRIDGE');
  });

  it('eventGatewayTargetProblem follows the engines: message/timer/signal/conditional catch events only', async () => {
    const doc = await gatewayDoc(
      '',
      `
    <bpmn:intermediateCatchEvent id="C_Cond"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression">\${x}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="C_Link"><bpmn:linkEventDefinition name="L" /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="C_None" />
    <bpmn:intermediateThrowEvent id="C_Throw" />
    <bpmn:userTask id="C_Task" />`,
    );
    const g = doc.require('Gateway_Wait');
    const problem = (id: string) => eventGatewayTargetProblem(doc, g, doc.require(id));
    expect(problem('C_Cond')).toBeUndefined();
    expect(problem('C_Link')).toMatch(/link catch event/);
    expect(problem('C_None')).toMatch(/plain catch event/);
    expect(problem('C_Throw')).toMatch(/not an intermediate catch event/);
    expect(problem('C_Task')).toMatch(/not an intermediate catch event/);
    // the timer already on a branch has its incoming flow from the gateway
    expect(problem('Event_Timeout')).toMatch(/already has the incoming flow F_T/);
  });
});

/* ------------------------------------------------------------------ */
/* 3 compensation handler host, duplicate flows                         */
/* ------------------------------------------------------------------ */

describe('boundary events on compensation handlers, duplicate flows (3)', () => {
  async function compDoc(): Promise<Doc> {
    return Doc.fromXml(
      definitionsXml(
        `
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Activity_Book" />
    <bpmn:serviceTask id="Activity_Book" camunda:expression="\${true}"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Book" targetRef="End" />
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="Event_Comp" attachedToRef="Activity_Book"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
    <bpmn:serviceTask id="Activity_Revoke" isForCompensation="true" camunda:expression="\${true}" />
    <bpmn:boundaryEvent id="Event_Other" attachedToRef="Activity_Book"><bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>`,
        { nsDecl: CAMUNDA, extraRoots: '' },
      ).replace('</bpmn:process>', '<bpmn:association id="A1" associationDirection="One" sourceRef="Event_Comp" targetRef="Activity_Revoke" /></bpmn:process>'),
    );
  }

  it('refuses to attach a boundary event to a compensation handler (add --on, move --on)', async () => {
    const doc = await compDoc();
    const err = caught(() => runOps(doc, [{ op: 'add', kind: 'boundaryEvent:timer', on: 'Activity_Revoke', timer: 'PT1H' } as Op]));
    expect(err.code).toBe('E_INVALID_HOST');
    expect(err.message).toMatch(/compensation handler/);
    expect(caught(() => moveElements(doc, { op: 'move', ids: ['Event_Other'], on: 'Activity_Revoke' })).code).toBe('E_INVALID_HOST');
    expect(doc.require('Event_Other').get<El>('attachedToRef').get('id')).toBe('Activity_Book');
    // a normal activity still takes boundary events
    runOps(doc, [{ op: 'add', kind: 'boundaryEvent:timer', id: 'Event_New', on: 'Activity_Book', timer: 'PT2H' } as Op]);
    expect(is(doc.require('Event_New'), 'bpmn:BoundaryEvent')).toBe(true);
  });

  it('warns W_DUPLICATE_FLOW when connect adds a second flow between the same nodes', async () => {
    const doc = await compDoc();
    const first = connectElements(doc, { op: 'connect', source: 'Start', target: 'End' });
    expect(first.warnings.map((w) => w.code)).not.toContain('W_DUPLICATE_FLOW');
    const second = connectElements(doc, { op: 'connect', source: 'Start', target: 'End' });
    const dup = second.warnings.find((w) => w.code === 'W_DUPLICATE_FLOW');
    // the file numbers its flows F1, F2: new ones keep the prefix and name their ends; the second one takes a suffix
    expect(dup?.message).toMatch(/Start -> End is already connected by the sequenceFlow F_StartToEnd\b/);
    expect(second.created.map((c) => c.id)).toEqual(['F_StartToEnd_2']);
    expect(second.warnings.map((w) => w.code)).toContain('W_ID_SUFFIXED');
    expect(dup?.hint).toMatch(/--if-absent/);
    const skipped = connectElements(doc, { op: 'connect', source: 'Start', target: 'End', ifAbsent: true });
    expect(skipped.warnings).toEqual([]);
    expect(skipped.created).toEqual([]);
    expect(many(doc.require('Process_1'), 'flowElements').filter((f) => is(f, 'bpmn:SequenceFlow') && f.get<El>('targetRef').get('id') === 'End')).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import type { Validator } from '../../src/write/HostValidators.js';
import { WriteTransaction } from '../../src/write/WriteTransaction.js';
import { Fixtures } from '../support/Fixtures.js';
import { BpmnError } from '../support/ModelValues.js';

const orderCheck = Fixtures.text('edit/order-check.bpmn');
const write = (xml: string, operations: unknown[], options = {}) => new WriteTransaction(options).apply(xml, operations);

const refusalOf = async (attempt: Promise<unknown>): Promise<BpmnError> => {
  const failure = await attempt.then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(BpmnError);
  return failure as BpmnError;
};

const answering = (name: string, findingsOf: (phase: string) => Array<{ severity: string; code: string; message: string; key?: string }>, blocks?: boolean): Validator => ({ name, blocks, validate: (_xml, { phase }) => findingsOf(phase) });

describe('WriteTransaction', () => {
  it('adds a task into the flow and reports it, its flows and the state of the file', async () => {
    const result = await write(orderCheck, [{ op: 'add', kind: 'userTask', name: 'Pack', after: 'ship', as: '$pack' }]);

    expect(result.created.map(({ kind }) => kind)).toEqual(['userTask', 'sequenceFlow']);
    expect(result.aliases).toEqual({ $pack: 'userTask_pack' });
    expect(result.xml).toContain('id="userTask_pack"');
    expect(result.unchanged).toBe(false);
    expect(result.state).toEqual({ errors: 0, warnings: expect.any(Number) });
  });

  it('keeps a new sub-process off an end event it gave up on before other moves freed the way', async () => {
    const add = { op: 'add', kind: 'subProcess', name: 'Review', id: 'review', after: 'H' };
    const inside = [{ op: 'add', kind: 'startEvent', name: 'In', id: 'in', in: 'review' }, { op: 'add', kind: 'serviceTask', name: 'Check', id: 'check', after: 'in' }, { op: 'add', kind: 'endEvent', name: 'Out', after: 'check' }];
    const { score } = await write(Fixtures.text('write/pool-tight-behind-a-long-name.bpmn'), [add, ...inside]);

    expect(score.after.counts['frameIntrusion']).toBe(0);
  });

  it('keeps the file byte for byte when a name is set to itself', async () => {
    const drawn = Fixtures.text('models/incremental/orders.bpmn');
    const [, id, name] = /<(?:bpmn:)?\w*[tT]ask id="([^"]+)" name="([^"]+)"/.exec(drawn)!;

    const result = await write(drawn, [{ op: 'set', id, set: { name } }]);

    expect(result.unchanged).toBe(true);
    expect(result.xml).toBe(drawn);
  });

  it('reports what the drawing operations did under format', async () => {
    const { format } = await write(orderCheck, [{ op: 'color', ids: ['check'], color: 'red' }]);

    expect(format).toEqual([expect.objectContaining({ op: 'color', index: 0, colored: ['check'] })]);
  });

  it('counts a drawing operation behind the model operations in the batch', async () => {
    const { format } = await write(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }, { op: 'color', ids: ['check'], color: 'red' }]);

    expect(format[0]?.index).toBe(1);
  });

  it('names the batch position of a drawing operation that fails', async () => {
    const refusal = await refusalOf(write(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }, { op: 'route', flow: 'flow_checkToOk', from: 'left', to: 'nowhere' }]));

    expect(refusal.code).toBe('E_USAGE');
  });

  it('refuses a model operation behind a drawing operation', async () => {
    const refusal = await refusalOf(write(orderCheck, [{ op: 'color', ids: ['check'], color: 'red' }, { op: 'add', kind: 'task', after: 'check' }]));

    expect(refusal.code).toBe('E_USAGE');
    expect(refusal.details.hint).toContain('two batches');
  });

  it('refuses a lossy import and writes it only when forced', async () => {
    const lossy = Fixtures.text('model/lossy.bpmn');

    expect((await refusalOf(write(lossy, [{ op: 'tidy' }]))).code).toBe('E_IMPORT_LOSSY');
    expect((await write(lossy, [{ op: 'tidy' }], { force: true })).xml).toBeTruthy();
  });

  it('keeps the score free of failed, as the writes of main do', async () => {
    const { score } = await write(Fixtures.text('model/lossy.bpmn'), [{ op: 'tidy' }], { force: true });

    expect(score.after.counts.failed).toBe(0);
  });

  it('has no score before on a file without a drawing', async () => {
    const { score } = await write(Fixtures.text('edit/plain-chain.bpmn'), [{ op: 'layout' }]);

    expect(score.before).toBeUndefined();
    expect(score.after.score).toBe(0);
  });

  it('refuses a placement the incremental layout cannot make, and a layout operation draws it', async () => {
    const vertical = Fixtures.text('models/incremental/vertical.bpmn');
    const task = /<bpmn:task id="([^"]+)"/.exec(vertical)![1];
    const add = { op: 'add', kind: 'task', name: 'New', after: task };

    expect((await refusalOf(write(vertical, [add]))).code).toBe('E_LAYOUT_INCREMENTAL');
    expect((await write(vertical, [add, { op: 'layout' }])).created[0]?.name).toBe('New');
  });

  it('refuses an error the change adds and writes it when forced', async () => {
    const add = { op: 'add', kind: 'eventSubProcess', name: 'Handle', id: 'handler' };

    const refusal = await refusalOf(write(orderCheck, [add]));
    const forced = await write(orderCheck, [add], { force: true });

    expect(refusal.code).toBe('E_VALIDATION');
    expect(refusal.details['errors']).toEqual([expect.objectContaining({ code: 'E_EVENT_SUBPROCESS_NO_START', element: 'handler' })]);
    expect(forced.findings.map(({ code }) => code)).toContain('E_EVENT_SUBPROCESS_NO_START');
  });

  it('writes past an error the touched element already had', async () => {
    const result = await write(Fixtures.text('edit/events-gateway.bpmn'), [{ op: 'set', id: 'loose_plain', set: { name: 'Still plain' } }]);

    expect(result.findings.map(({ code }) => code)).toContain('E_INVALID_TRIGGER');
    expect(result.state.errors).toBeGreaterThan(0);
  });

  it.each([
    ['removes the only start of an event sub-process', { op: 'remove', ids: ['Event_CancelRequested'] }, 'Activity_OnCancel'],
    ['removes the pool of a collaboration with message flows', { op: 'remove', ids: ['Participant_Insurer'] }, undefined],
    ['turns an event sub-process into a plain one around its message start', { op: 'set', id: 'Activity_OnCancel', set: { triggeredByEvent: false } }, undefined],
  ])('refuses a write that %s, though the error sits at an element it did not touch', async (_change, operation, element) => {
    const claims = Fixtures.text('models/views/claims.bpmn');

    const refusal = await refusalOf(write(claims, [operation]));

    expect(refusal.code).toBe('E_VALIDATION');
    expect(refusal.details['errors']).toEqual(expect.arrayContaining([expect.objectContaining(element ? { element } : { code: expect.stringMatching(/^E_/) })]));
  });

  it('reports a forced error at an untouched element among the findings', async () => {
    const { findings, state } = await write(Fixtures.text('models/views/claims.bpmn'), [{ op: 'remove', ids: ['Event_CancelRequested'] }], { force: true });

    expect(state.errors).toBeGreaterThan(0);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', element: 'Activity_OnCancel' })]));
  });

  it('counts an error elsewhere in the state and leaves it out of the findings', async () => {
    const { findings, state } = await write(Fixtures.text('edit/events-gateway.bpmn'), [{ op: 'set', id: 'loose_task', set: { name: 'Renamed' } }]);

    expect(findings.filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(state.errors).toBeGreaterThan(0);
  });

  it('runs a host validator on the old file, then on the new one, and refuses the error it adds', async () => {
    const phases: string[] = [];
    const gate = answering('gate', (phase) => {
      phases.push(phase);
      return phase === 'after' ? [{ severity: 'ERROR', code: 'gate/new', message: 'new' }] : [];
    });

    const refusal = await refusalOf(write(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }], { validators: [gate] }));

    expect(phases).toEqual(['before', 'after']);
    expect(refusal.code).toBe('E_VALIDATION');
    expect(refusal.message).toContain('validator gate');
  });

  it('lets an advisory validator report the error it adds', async () => {
    const advice = answering('advice', (phase) => (phase === 'after' ? [{ severity: 'error', code: 'advice/new', message: 'new' }] : []), false);

    const { findings } = await write(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }], { validators: [advice] });

    expect(findings).toEqual([expect.objectContaining({ code: 'advice/new', validator: 'advice' })]);
  });

  it('writes past a host finding the file already had and lists it as preexisting', async () => {
    const old = answering('gate', () => [{ severity: 'error', code: 'gate/old', message: 'old', key: 'old' }]);

    const { preexisting, findings } = await write(orderCheck, [{ op: 'set', id: 'check', set: { name: 'Check' } }], { validators: [old] });

    expect(preexisting.map(({ code }) => code)).toEqual(['gate/old']);
    expect(findings).toEqual([]);
  });

  it('follows the id conventions of the call', async () => {
    const conventions = { prefixes: { 'bpmn:UserTask': 'UT_' } };

    const { created } = await write(orderCheck, [{ op: 'add', kind: 'userTask', name: 'Pack', after: 'ship' }], { conventions });

    expect(created[0]?.id).toBe('UT_pack');
  });

  it('refuses text that is no BPMN with E_PARSE', async () => {
    expect((await refusalOf(write('<not-bpmn/>', [{ op: 'tidy' }]))).code).toBe('E_PARSE');
  });
});

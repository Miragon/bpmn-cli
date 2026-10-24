/**
 * Regression tests for #75: an event sub-process has no place in the flow to
 * interrupt or leave, so it cannot carry boundary events (bpmn-js refuses the
 * attach as well). add --on and move --on refuse it, validate reports it.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model/Doc.js';
import type { El } from '../src/model/utils/moddle.js';
import { runOps } from '../src/index.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/index.js';
import { validateDoc } from '../src/validate/structural.js';
import { definitionsXml } from './helpers.js';
import { NodeMover } from '../src/ops/NodeMover.js';

const TIMER = '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';

const ORDER = definitionsXml(`
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Activity_Ship" />
    <bpmn:subProcess id="Activity_Ship"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:subProcess>
    <bpmn:sequenceFlow id="F2" sourceRef="Activity_Ship" targetRef="End" />
    <bpmn:endEvent id="End"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="Event_ShipTimeout" attachedToRef="Activity_Ship">${TIMER}</bpmn:boundaryEvent>
    <bpmn:subProcess id="Activity_Audit">
      <bpmn:startEvent id="Event_AuditRequested"><bpmn:messageEventDefinition /></bpmn:startEvent>
    </bpmn:subProcess>
    <bpmn:boundaryEvent id="Event_AuditTimeout" attachedToRef="Activity_Audit">${TIMER}</bpmn:boundaryEvent>
    <bpmn:subProcess id="Activity_CancelOrder" triggeredByEvent="true">
      <bpmn:startEvent id="Event_Cancel"><bpmn:messageEventDefinition /></bpmn:startEvent>
    </bpmn:subProcess>`);

function caught(fn: () => unknown): { code?: string; message: string; details: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

async function caughtAsync(fn: () => Promise<unknown>): Promise<{ code?: string; message: string; details: Record<string, unknown> }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected an error');
}

describe('boundary events on an event sub-process (#75)', () => {
  it('add --on an event sub-process is refused with E_INVALID_HOST', async () => {
    const doc = await Doc.fromXml(ORDER);
    const err = caught(() => runOps(doc, [{ op: 'add', kind: 'boundaryEvent:timer', id: 'Event_New', on: 'Activity_CancelOrder', timer: 'PT1H' } as Op]));
    expect(err.code).toBe('E_INVALID_HOST');
    expect(err.message).toMatch(/event sub-process/);
    expect(doc.has('Event_New')).toBe(false);
  });

  it('move --on an event sub-process is refused with E_INVALID_HOST', async () => {
    const doc = await Doc.fromXml(ORDER);
    expect(caught(() => new NodeMover(doc).move({ op: 'move', ids: ['Event_ShipTimeout'], on: 'Activity_CancelOrder' })).code).toBe('E_INVALID_HOST');
    expect(doc.require('Event_ShipTimeout').get<El>('attachedToRef').get('id')).toBe('Activity_Ship');
  });

  it('validate reports E_INVALID_HOST for a loaded file', async () => {
    const doc = await Doc.fromXml(ORDER.replace('attachedToRef="Activity_Ship"', 'attachedToRef="Activity_CancelOrder"'));
    const err = validateDoc(doc).errors.find((e) => e.code === 'E_INVALID_HOST');
    expect(err).toMatchObject({ element: 'Event_ShipTimeout', related: ['Activity_CancelOrder'] });
    expect(err!.message).toMatch(/event sub-process/);
  });

  it('set triggeredByEvent=true on a sub-process with a boundary event is refused (E_VALIDATION)', async () => {
    const doc = await Doc.fromXml(ORDER);
    const err = await caughtAsync(() => mutateDoc(doc, [{ op: 'set', id: 'Activity_Audit', values: { triggeredByEvent: 'true' } }], { dryRun: true, layout: false }));
    expect(err.code).toBe('E_VALIDATION');
    expect(JSON.stringify(err.details)).toMatch(/E_INVALID_HOST/);
  });
});

/**
 * The row choice of a branch or exception path charges a trial route through a label enough that a
 * clean row wins (src/domain/diagram/layout/incremental/RowChooser.ts connectionCost, LABEL_HIT):
 * a timer's path does not run down through the name of an end event next to its circle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../../src/api.js';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { shapes } from '../../../../helpers/drawing.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('a trial route through a label', () => {
  it('a boundary path takes its host\'s top border instead of running through an end event\'s name (public scenario)', async () => {
    const xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'agent__o2c.e4.bpmn'), 'utf8');
    // a task on the first flow with a gateway and a rejection path, then a timer on it with a reminder
    const ops = [
      { op: 'add', kind: 'userTask', id: 'Activity_Approve', name: 'Approval', flow: 'Flow_3' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_Approved', name: 'Approved?', after: 'Activity_Approve', before: 'Activity_CheckCredit' },
      { op: 'add', kind: 'sendTask', id: 'Activity_Reject', name: 'Rejection', after: 'Gateway_Approved', flowName: 'no' },
      { op: 'add', kind: 'endEvent', id: 'Event_Rejected', name: 'Rejected', after: 'Activity_Reject' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'Event_Timer', name: '3 days', on: 'Activity_Approve', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', id: 'Activity_Remind', name: 'Reminder', after: 'Event_Timer' },
      { op: 'add', kind: 'endEvent', id: 'Event_Reminded', name: 'Reminded', after: 'Activity_Remind' },
    ];
    const applied = await applyToXml(xml, ops, { force: true });
    expect((applied.result.layout.metrics?.added ?? []).map((problem) => problem.kind)).not.toContain('labelOnLine');
    // the end event below the new task keeps its name where it was
    const before = shapes(await Doc.fromXml(xml));
    const after = shapes(await Doc.fromXml(applied.xml));
    expect(after.get('Event_OrderRejected')!.label).toEqual(before.get('Event_OrderRejected')!.label);
    // the timer sits on the top border and its reminder above the task
    const host = after.get('Activity_Approve')!.bounds;
    const remind = after.get('Activity_Remind')!.bounds;
    expect(after.get('Event_Timer')!.bounds.y + 18).toBe(host.y);
    expect(remind.y + remind.height).toBeLessThan(host.y);
  });
});

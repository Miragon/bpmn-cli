/**
 * The crossing repair does not lay a hand-drawn line on top of the others to save a crossing
 * (src/domain/diagram/layout/incremental/CrossingRepair.ts reroutes): run up a gateway's branches
 * into a join, it would read as their continuation. The crossing stays instead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../../../src/api.js';
import { diffProblems } from '../../../../../src/domain/diagram/utils/problems.js';
import { LayoutAnalysis } from '../../../../../src/domain/diagram/di/LayoutAnalysis.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('the crossing repair keeps a hand-drawn line off the others', () => {
  it('Pack items keeps its line into the join instead of running up the branches of Charged? (public scenario)', async () => {
    const xml = readFileSync(join(ROOT, 'tools', 'scenarios', 'controlflow__s16.bpmn'), 'utf8');
    // a gateway on the "no" branch of Charged? whose rejection path crosses the lines into the join
    const ops = [
      { op: 'add', kind: 'userTask', id: 'Activity_Approve', name: 'Approve', flow: 'Flow_24' },
      { op: 'add', kind: 'exclusiveGateway', id: 'Gateway_Approved', name: 'Approved?', after: 'Activity_Approve', before: 'Activity_RetryCharge' },
      { op: 'add', kind: 'sendTask', id: 'Activity_Reject', name: 'Reject', after: 'Gateway_Approved', flowName: 'no' },
      { op: 'add', kind: 'endEvent', id: 'Event_Rejected', name: 'Rejected', after: 'Activity_Reject' },
      { op: 'add', kind: 'boundaryEvent:timer', id: 'Event_3DaysApproval', name: '3 days', on: 'Activity_Approve', timer: 'P3D', nonInterrupting: true },
      { op: 'add', kind: 'sendTask', id: 'Activity_Remind', name: 'Remind', after: 'Event_3DaysApproval' },
      { op: 'add', kind: 'endEvent', id: 'Event_Reminded', name: 'Reminded', after: 'Activity_Remind' },
    ];
    const applied = await applyToXml(xml, ops, { force: true });
    expect(applied.result.layout?.mode).toBe('incremental');
    expect(applied.result.layout?.rerouted ?? []).not.toContain('Flow_14');
    const { added } = diffProblems((await LayoutAnalysis.ofXml(xml)).problems, (await LayoutAnalysis.ofXml(applied.xml)).problems);
    expect(added.filter((problem) => problem.kind === 'parallelRun')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { StructureFindings } from '../../../src/checks/structure/StructureFindings.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('StructureFindings', () => {
  it('names an element by its kind, id and name', async () => {
    const document = await Fixtures.read('engine/structure/flow-node-with-a-name-used-twice.bpmn');

    expect(new StructureFindings().describe(document.tree.require('A'))).toBe('task A "Check"');
    expect(new StructureFindings().describe(document.tree.require('Start'))).toBe('startEvent Start');
  });

  it('leaves out what a finding does not have', () => {
    const findings = new StructureFindings();
    findings.error('E_DUPLICATE_ID', 'twice', undefined, { related: [] });
    findings.warning('W_DEAD_END', 'ends here', 'task', { hint: 'continue it', related: ['flow'] });

    expect(findings.all).toEqual([
      { code: 'E_DUPLICATE_ID', message: 'twice', severity: 'error' },
      { code: 'W_DEAD_END', message: 'ends here', severity: 'warning', element: 'task', hint: 'continue it', related: ['flow'] },
    ]);
  });
});

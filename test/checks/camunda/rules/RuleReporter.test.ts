import { describe, expect, it } from 'vitest';
import { RuleReporter } from '../../../../src/checks/camunda/rules/RuleReporter.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('RuleReporter', () => {
  const report = { code: 'W_C8_DEPLOY_TIMER', subject: 'timer', message: 'no timer', hint: 'set one' };

  it('reports a nested element on its flow node', async () => {
    const { tree } = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const event = tree.require('B');
    const reporter = new RuleReporter(tree.definitions);
    reporter.deploy({ ...report, element: event.list('eventDefinitions')[0], owner: event });

    expect(reporter.findings).toEqual([{ code: 'W_C8_DEPLOY_TIMER', severity: 'deploy', message: 'no timer', hint: 'set one', element: 'B' }]);
    expect(reporter.findings[0]!.subject).toBe('timer');
  });

  it('gives a finding the severity of the method that reports it and its suggested fix', async () => {
    const { tree } = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const reporter = new RuleReporter(tree.definitions);
    reporter.runtime({ ...report, element: tree.require('T'), fix: { op: 'remove', ids: ['T'] } });
    reporter.practice({ ...report, element: tree.require('T') });

    expect(reporter.findings.map(({ severity }) => severity)).toEqual(['runtime', 'practice']);
    expect(reporter.findings[0]!.fix).toEqual({ op: 'remove', ids: ['T'] });
  });

  it('starts at the definitions, and follows the walk', async () => {
    const { tree } = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const reporter = new RuleReporter(tree.definitions);

    expect(reporter.host).toBe(tree.definitions);
    reporter.enter(tree.require('T'), tree.require('P'), false);
    expect([reporter.host, reporter.owner, reporter.executable]).toEqual([tree.require('T'), tree.require('P'), false]);
  });
});

import { describe, expect, it } from 'vitest';
import { ProblemReport, type LayoutProblem } from '../../../src/scoring/plane/ProblemReport.js';

describe('ProblemReport', () => {
  it('drops a problem a second plane reports again', () => {
    const report = new ProblemReport();

    report.add('overlaps', 'task_a~task_b', ['task_a', 'task_b']);
    report.add('overlaps', 'task_a~task_b', ['task_a', 'task_b']);

    expect(report.problems()).toEqual([{ kind: 'overlaps', ids: ['task_a', 'task_b'] }]);
  });

  it('lists problems in the order of the kinds', () => {
    const report = new ProblemReport();

    report.add('labelOnLine', 'first', ['event', 'flow']);
    report.add('laneGap', 'second', ['lane', 'pool'], 'top');
    report.add('crossings', 'third', ['flow_a', 'flow_b']);

    expect(report.problems().map(({ kind }) => kind)).toEqual(['crossings', 'labelOnLine', 'laneGap']);
  });

  it.each<[string, LayoutProblem, LayoutProblem]>([
    ['the ids of a crossing in either order', { kind: 'crossings', ids: ['flow_b', 'flow_a'] }, { kind: 'crossings', ids: ['flow_a', 'flow_b'] }],
    ['the ids of a label on a label in either order', { kind: 'labelClash', ids: ['b', 'a'], detail: ProblemReport.LABEL_ON_LABEL }, { kind: 'labelClash', ids: ['a', 'b'], detail: ProblemReport.LABEL_ON_LABEL }],
    ['a parallel run of another length', { kind: 'parallelRun', ids: ['a', 'b'], detail: '30px' }, { kind: 'parallelRun', ids: ['a', 'b'], detail: '40px' }],
  ])('takes %s for the same problem', (_, first, second) => {
    expect(ProblemReport.identityOf(first)).toBe(ProblemReport.identityOf(second));
  });

  it.each<[string, LayoutProblem, LayoutProblem]>([
    ['a label on a shape from the shape on its label', { kind: 'labelClash', ids: ['a', 'b'], detail: 'label on shape' }, { kind: 'labelClash', ids: ['b', 'a'], detail: 'label on shape' }],
    ['the top gap of a lane from its bottom gap', { kind: 'laneGap', ids: ['lane', 'pool'], detail: 'top' }, { kind: 'laneGap', ids: ['lane', 'pool'], detail: 'bottom' }],
  ])('tells %s', (_, first, second) => {
    expect(ProblemReport.identityOf(first)).not.toBe(ProblemReport.identityOf(second));
  });
});

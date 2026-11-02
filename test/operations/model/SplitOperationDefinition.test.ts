import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SplitOperationDefinition } from '../../../src/operations/model/SplitOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['splits after an anchor into two branches', { after: 'a', kind: 'exclusiveGateway', name: 'Ok?', as: '$ok', joinAs: '$join', branches: [{ flowName: 'yes', condition: '=ok', nodes: [{ kind: 'task', as: '$b' }] }, { default: true, nodes: [] }] }],
  ['needs a branch', { after: 'a', branches: [] }, '"branches" needs at least 1 branch'],
  ['needs a list of branches', { after: 'a', branches: 'yes' }, '"branches" must be an array of branch objects'],
  ['refuses a kind that is no gateway', { after: 'a', kind: 'userTask', branches: [{ nodes: [] }] }, '"kind" must be a gateway kind'],
  ['names the node a refusal sits at', { after: 'a', branches: [{ nodes: [{ kind: 'task' }, { kind: 'nope' }] }] }, 'ops[0].branches[0].nodes[1]'],
];

describe('SplitOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new SplitOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});

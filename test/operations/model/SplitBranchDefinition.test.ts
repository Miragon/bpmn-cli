import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { SplitBranchDefinition } from '../../../src/operations/model/SplitBranchDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['holds the flow from the gateway and the nodes behind it', { flowName: 'yes', flowId: 'flow', condition: '=ok', language: 'feel', nodes: [{ kind: 'task' }] }],
  ['is a direct flow to the join without nodes', { nodes: [] }],
  ['needs its nodes', { flowName: 'yes' }, 'missing required key "nodes"'],
  ['refuses a default flow with a condition', { default: true, condition: '=ok', nodes: [] }, 'mutually exclusive'],
  ['refuses a node that is no object', { nodes: ['task'] }, 'expected an object, got string "task"'],
];

describe('SplitBranchDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new SplitBranchDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});

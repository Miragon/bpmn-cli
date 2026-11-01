import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';

describe('OperationLocation', () => {
  it('refuses with the path of the operation, its index, the hint and the candidates', () => {
    const refusal = new OperationLocation(2, 'ops[2] (add)').refusal('no good', 'try this', ['that']);
    expect(refusal.code).toBe('E_USAGE');
    expect(refusal.category).toBe('usage');
    expect(refusal.message).toBe('ops[2] (add): no good');
    expect(refusal.details).toMatchObject({ op: 2, hint: 'try this', candidates: ['that'] });
  });

  it('leaves hint and candidates out when there are none', () => {
    expect(new OperationLocation(0, 'ops[0]').refusal('no good').details).toEqual({ op: 0, asCommand: { message: ['no good'] } });
  });

  it('keeps apart how a batch and a single command read the refusal', () => {
    const refusal = new OperationLocation(0, 'ops[0] (add)').refusal((key) => `${key('flowName')} needs more`, undefined, [], 'E_OTHER');
    expect(refusal.message).toBe('ops[0] (add): "flowName" needs more');
    expect(refusal.details.asCommand).toEqual({ message: ['', { key: 'flowName' }, ' needs more'], code: 'E_OTHER' });
  });

  it('steps into a nested list and keeps the index of the operation', () => {
    const inner = new OperationLocation(1, 'ops[1] (split)').inside('branches[0]').inside('nodes[2]');
    expect(inner.path).toBe('ops[1] (split).branches[0].nodes[2]');
    expect(inner.index).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { OperationLocation } from '../../../src/operations/fields/OperationLocation.js';
import { AddOperationDefinition } from '../../../src/operations/model/AddOperationDefinition.js';

type Example = [says: string, operation: Record<string, unknown>, refusal?: string, parsedAs?: Record<string, unknown>];

const EXAMPLES: Example[] = [
  ['appends a user task after an anchor', { kind: 'userTask', name: 'Check', after: 'start', id: 'check', as: '$check', lane: 'sales' }],
  ['splices between two nodes with after and before', { kind: 'task', after: 'a', before: 'b' }],
  ['sits a timer boundary event on its host with what it holds under set', { kind: 'boundaryEvent:timer', on: 'check', set: { timer: 'P2D', nonInterrupting: 'true' } }],
  ['names the flow into the node and the flow out of it', { kind: 'task', after: 'a', flowName: 'yes', condition: '=ok', flowAs: '$in', outAs: '$out', to: 'b' }],
  ['creates an event sub-process with its trigger', { kind: 'eventSubProcess:error', in: 'order' }],
  ['creates a black-box pool and a lane with its members', { kind: 'participant', blackBox: true }],
  ['needs a kind', {}, 'missing required key "kind"'],
  ['refuses a kind that does not exist', { kind: 'nope' }, 'Unknown kind "nope"'],
  ['refuses a trigger the event sub-process cannot start with', { kind: 'eventSubProcess:terminate' }, 'not allowed on eventSubProcess'],
  ['refuses timer outside set and lists the keys add takes', { kind: 'boundaryEvent:timer', on: 'check', timer: 'P2D' }, 'unknown key "timer" (did you mean "set"?); allowed keys: kind, name, id'],
  ['refuses timer on a user task, which set does not take there either, without offering set', { kind: 'userTask', in: 'p', timer: 'P2D' }, 'unknown key "timer"; allowed keys: kind, name, id'],
  ['offers set for a key set takes on the kind, though it starts like a key of add', { kind: 'receiveTask', in: 'p', instantiate: true }, 'unknown key "instantiate" (did you mean "set"?)'],
  ['offers name for nam, a cut name', { kind: 'userTask', in: 'p', nam: 'Ship' }, 'unknown key "nam" (did you mean "name"?)'],
  ['offers name for naem, a swapped name', { kind: 'userTask', in: 'p', naem: 'Ship' }, 'unknown key "naem" (did you mean "name"?)'],
  ['offers the key of add for a typo near a key of add and of set', { kind: 'task', in: 'p', nme: 'Ship' }, 'unknown key "nme" (did you mean "name"?)'],
  ['refuses doc outside set',{ kind: 'task', doc: 'Four eyes' }, 'unknown key "doc"'],
  ['refuses collapsed, which is expanded=false under set', { kind: 'subProcess', collapsed: true }, 'unknown key "collapsed"'],
  ['refuses timerKind', { kind: 'startEvent:timer', timerKind: 'cycle' }, 'unknown key "timerKind"'],
  ['refuses two placements', { kind: 'task', after: 'a', in: 'b' }, '"after" and "in" cannot be combined'],
  ['refuses a flow option without a flow into the node', { kind: 'task', in: 'order', flowName: 'yes' }, '"flowName" describe the flow into the node'],
  ['refuses a default flow with a condition', { kind: 'task', after: 'a', default: true, condition: '=ok' }, 'mutually exclusive'],
  ['refuses ifAbsent without an id', { kind: 'task', ifAbsent: true }, '"ifAbsent" needs an explicit "id"'],
  ['refuses outAs on what has no outgoing flow', { kind: 'lane', outAs: '$out', after: 'a' }, 'creates no sequence flow out of it'],
  ['refuses outAs when no flow leaves the node', { kind: 'task', in: 'order', outAs: '$out' }, '"outAs" names the flow out of the node'],
];

describe('AddOperationDefinition', () => {
  it.each(EXAMPLES)('%s', (_says, operation, refusal, parsedAs) => {
    const read = () => new AddOperationDefinition().read(operation, new OperationLocation(0, 'ops[0]'));
    if (refusal) {
      expect(read).toThrow(expect.objectContaining({ code: 'E_USAGE', message: expect.stringContaining(refusal) }));
    } else {
      expect(read()).toEqual(parsedAs ?? operation);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { FlowOptions } from '../../../src/edit/flows/FlowOptions.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function orderCheck() {
  const document = await Fixtures.readForWrite('edit/order-check.bpmn');
  return { edit: new EditSession(document), document, changes: new ChangeSet() };
}

describe('FlowOptions', () => {
  it('keeps only the flow options of a branch or a node', () => {
    expect(FlowOptions.of({ flowName: 'yes', default: false, ...{ kind: 'task' } })).toEqual({ flowName: 'yes', default: false });
  });

  it('names the flags given, but not a default that is off', () => {
    expect(new FlowOptions({ flowName: 'yes', condition: '', default: false }).flags).toEqual(['--flow-name', '--condition']);
  });

  it('turns the options into what a new flow holds', () => {
    expect(new FlowOptions({ flowId: 'flow_x', flowName: 'yes', condition: '${ok}', language: 'juel', default: true }).toAttrs()).toEqual({ id: 'flow_x', name: 'yes', condition: '${ok}', language: 'juel', isDefault: true });
  });

  it('drops an empty condition unless the caller wants the rules to refuse it', () => {
    expect(new FlowOptions({ condition: '' }).toAttrs()).toEqual({});
    expect(new FlowOptions({ condition: '' }).toAttrs(true)).toEqual({ condition: '' });
  });

  it('turns the options into a connect, which takes no empty set', () => {
    expect(new FlowOptions({ flowId: 'flow_x', flowName: 'yes', condition: '', language: 'feel', default: true }).toConnect()).toEqual({ id: 'flow_x', set: { name: 'yes', condition: '', language: 'feel', default: 'true' } });
    expect(new FlowOptions({}).toConnect()).toEqual({});
  });

  it('names and conditions an existing flow and reports it once', async () => {
    const { edit, document, changes } = await orderCheck();
    const flow = document.tree.require('flow_okToReject');

    new FlowOptions({ flowName: 'late', condition: '${late}', language: 'juel' }).apply(edit, flow, changes);

    expect(flow.name).toBe('late');
    expect(flow.get<BpmnElement>('conditionExpression').get('body')).toBe('${late}');
    expect(changes.changed.map(({ id }) => id)).toEqual(['flow_okToReject']);
  });

  it('clears a flow name given empty and makes the flow the default of its gateway', async () => {
    const { edit, document, changes } = await orderCheck();
    const flow = document.tree.require('flow_okToShip');

    new FlowOptions({ flowName: '', default: true }).apply(edit, flow, changes);

    expect(flow.name).toBeUndefined();
    expect(document.tree.require('gateway_ok').get('default')).toBe(flow);
  });

  it('leaves a flow unreported when no option touches it', async () => {
    const { edit, document, changes } = await orderCheck();

    new FlowOptions({ default: false }).apply(edit, document.tree.require('flow_okToShip'), changes);

    expect(changes.changed).toEqual([]);
  });
});

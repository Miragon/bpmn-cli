import { describe, expect, it } from 'vitest';
import type { Doc } from '../src/domain/document/Doc.js';
import { isCliError } from '../src/domain/document/utils/errors.js';
import { validateDoc } from '../src/index.js';
import { definitionsXml, docFromXml } from './helpers.js';
import { ElementTypeChangeService } from '../src/domain/editing/ElementTypeChangeService.js';
import { ElementCreationService } from '../src/domain/editing/ElementCreationService.js';
import { ConnectionService } from '../src/domain/editing/ConnectionService.js';
import { PropertyService } from '../src/domain/editing/PropertyService.js';
import { EditContext } from '../src/domain/document/EditContext.js';

const forkXml = (gateway: string, conditionOnA = '') =>
  definitionsXml(`
    <bpmn:startEvent id="S" />
    <bpmn:${gateway} id="Gw" />
    <bpmn:exclusiveGateway id="Xor" />
    <bpmn:task id="A" />
    <bpmn:task id="B" />
    <bpmn:task id="C" />
    <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="Gw" />
    <bpmn:sequenceFlow id="FA" sourceRef="Gw" targetRef="A">${conditionOnA}</bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="FB" sourceRef="Gw" targetRef="B" />
    <bpmn:sequenceFlow id="FX" sourceRef="Xor" targetRef="C"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${x}</bpmn:conditionExpression></bpmn:sequenceFlow>
  `);

const CONDITION = '<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${x}</bpmn:conditionExpression>';

function errorCodeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (isCliError(error)) return error.code;
    throw error;
  }
  return undefined;
}

const conditionOf = (doc: Doc, id: string) => doc.require(id).get('conditionExpression');

describe('conditions on flows out of parallel and event-based gateways', () => {
  for (const gateway of ['parallelGateway', 'eventBasedGateway']) {
    it(`set condition= on a flow out of a ${gateway} is refused`, async () => {
      const doc = await docFromXml(forkXml(gateway));
      expect(errorCodeOf(() => new PropertyService(doc, new EditContext(doc)).set({ op: 'set', id: 'FA', values: { condition: '${x}' } }))).toBe('E_INVALID_VALUE');
      expect(conditionOf(doc, 'FA')).toBeUndefined();
    });
  }

  it('add --after a parallel gateway with --condition is refused', async () => {
    const doc = await docFromXml(forkXml('parallelGateway'));
    expect(errorCodeOf(() => new ElementCreationService(doc, new EditContext(doc)).add({ op: 'add', kind: 'task', name: 'D', after: 'Gw', condition: '${x}' }))).toBe('E_INVALID_VALUE');
  });

  it('connect from a parallel gateway with a condition is refused', async () => {
    const doc = await docFromXml(forkXml('parallelGateway'));
    expect(errorCodeOf(() => new ConnectionService(doc, new EditContext(doc)).connect({ op: 'connect', source: 'Gw', target: 'C', condition: '${x}' }))).toBe('E_INVALID_VALUE');
  });

  it('removing the condition of such a flow still works', async () => {
    const doc = await docFromXml(forkXml('parallelGateway', CONDITION));
    new PropertyService(doc, new EditContext(doc)).set({ op: 'set', id: 'FA', values: { condition: '' } });
    expect(conditionOf(doc, 'FA')).toBeUndefined();
  });

  it('retype exclusive -> event-based drops the conditions with W_CONDITION_DROPPED', async () => {
    const doc = await docFromXml(forkXml('exclusiveGateway', CONDITION));
    const cs = new ElementTypeChangeService(doc, new EditContext(doc)).retype({ op: 'retype', id: 'Gw', kind: 'eventBasedGateway' });
    expect(cs.warnings.map((warning) => [warning.code, warning.element])).toEqual([['W_CONDITION_DROPPED', 'FA']]);
    expect(conditionOf(doc, 'FA')).toBeUndefined();
  });

  it('set source= behind a parallel gateway drops the condition with W_CONDITION_DROPPED', async () => {
    const doc = await docFromXml(forkXml('parallelGateway'));
    const cs = new PropertyService(doc, new EditContext(doc)).set({ op: 'set', id: 'FX', values: { source: 'Gw' } });
    expect(cs.warnings.map((warning) => [warning.code, warning.element])).toEqual([['W_CONDITION_DROPPED', 'FX']]);
    expect(conditionOf(doc, 'FX')).toBeUndefined();
  });

  it('validate reports W_CONDITION_IGNORED without a platform', async () => {
    const doc = await docFromXml(forkXml('parallelGateway', CONDITION));
    const findings = validateDoc(doc).warnings.filter((warning) => warning.code === 'W_CONDITION_IGNORED');
    expect(findings.map((warning) => [warning.element, warning.related])).toEqual([['Gw', ['FA']]]);
  });
});

import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-exclusive-gateway.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

/** Start -> G, and one flow S<n> per entry (its condition, or none) to an end event */
const exclusive = (conditions: Array<string | null>, defaultFlow?: string) => {
  const branches = conditions.map((condition, index) => {
    const expression = condition
      ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${condition}</bpmn:conditionExpression>`
      : '';
    return `<bpmn:sequenceFlow id="S${index}" sourceRef="G" targetRef="End${index}">${expression}</bpmn:sequenceFlow><bpmn:endEvent id="End${index}" />`;
  });
  return `<bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:exclusiveGateway id="G"${defaultFlow ? ` default="${defaultFlow}"` : ''} />
    ${branches.join('\n')}`;
};

const REFUSED = 'the engines refuse the file';
const unconditioned = (flowId: string, count = '') => ({
  id: 'G',
  message: `Flow ${flowId} of exclusive gateway G has no condition and is not the default flow${count}; ${REFUSED}`,
  type: ERROR_TYPES.PROPERTY_REQUIRED,
});
const conditionedDefault = (flowId: string) => ({
  id: 'G',
  message: `Default flow ${flowId} of exclusive gateway G has a condition; ${REFUSED}`,
  type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
});

verifyEngineRule('c7-exclusive-gateway', rule, {
  valid: [
    {
      name: 'conditions plus a default flow',
      moddleElement: engineModel('c7', exclusive(['${a}', null], 'S1')),
    },
    {
      name: 'one flow without condition and no default (c7-implicit-default-flow reports it)',
      moddleElement: engineModel('c7', exclusive(['${a}', null])),
    },
    {
      name: 'a single outgoing flow without condition',
      moddleElement: engineModel('c7', exclusive([null])),
    },
    {
      name: 'a single default flow without condition',
      moddleElement: engineModel('c7', exclusive([null], 'S0')),
    },
    {
      name: 'two flows without condition in a non-executable process',
      moddleElement: engineModel('c7', exclusive(['${a}', null, null]), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'two flows without condition in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${exclusive(['${a}', null, null])}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', exclusive(['${a}', null, null])),
    },
  ],
  invalid: [
    {
      name: 'a flow without condition next to the default flow',
      moddleElement: engineModel('c7', exclusive(['${a}', null, null], 'S2')),
      report: unconditioned('S1'),
    },
    {
      name: 'two flows without condition',
      moddleElement: engineModel('c7', exclusive(['${a}', null, null])),
      report: [unconditioned('S1', ' (2 such flows)'), unconditioned('S2', ' (2 such flows)')],
    },
    {
      name: 'a single outgoing flow with a condition',
      moddleElement: engineModel('c7', exclusive(['${a}'])),
      report: {
        id: 'G',
        message: `Exclusive gateway G has a single outgoing flow S0 with a condition; ${REFUSED}`,
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'a single default flow with a condition',
      moddleElement: engineModel('c7', exclusive(['${a}'], 'S0')),
      report: conditionedDefault('S0'),
    },
    {
      name: 'a conditional default flow',
      moddleElement: engineModel('c7', exclusive(['${a}', '${b}'], 'S1')),
      report: conditionedDefault('S1'),
    },
    {
      name: 'no outgoing flow',
      moddleElement: engineModel(
        'c7',
        '<bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" /><bpmn:exclusiveGateway id="G" />',
      ),
      report: {
        id: 'G',
        message: `Exclusive gateway G has no outgoing flow; ${REFUSED}`,
        path: ['outgoing'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
  ],
});

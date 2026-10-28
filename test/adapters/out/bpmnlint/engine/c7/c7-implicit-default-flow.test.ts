import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-implicit-default-flow.js';
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

verifyEngineRule('c7-implicit-default-flow', rule, {
  valid: [
    {
      name: 'conditions plus a default flow',
      moddleElement: engineModel('c7', exclusive(['${a}', null], 'S1')),
    },
    {
      name: 'every flow has a condition',
      moddleElement: engineModel('c7', exclusive(['${a}', '${b}'])),
    },
    {
      name: 'a single outgoing flow without condition',
      moddleElement: engineModel('c7', exclusive([null])),
    },
    {
      name: 'two flows without condition (c7-exclusive-gateway reports it)',
      moddleElement: engineModel('c7', exclusive(['${a}', null, null])),
    },
    {
      name: 'one flow without condition and no default in a non-executable process',
      moddleElement: engineModel('c7', exclusive(['${a}', null]), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'one flow without condition and no default in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${exclusive(['${a}', null])}</bpmn:adHocSubProcess>`,
      ),
    },
    { name: 'a Camunda 8 diagram', moddleElement: engineModel('c8', exclusive(['${a}', null])) },
  ],
  invalid: [
    {
      name: 'one flow without condition and no default',
      moddleElement: engineModel('c7', exclusive(['${a}', null])),
      report: {
        id: 'G',
        message:
          'Flow S1 of exclusive gateway G has no condition and is not the default flow; the engines take it as the default and log a warning',
        path: ['default'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
  ],
});

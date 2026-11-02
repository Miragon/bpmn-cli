import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ExclusiveGatewayNeedsOutgoingRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-exclusive-gateway-needs-outgoing', () => {
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

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'conditions plus a default flow',
        moddleElement: engineModel('c7', exclusive(['${a}', null], 'S1')),
      },
      {
        name: 'one flow without condition and no default (c7-exclusive-gateway-needs-default reports it)',
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
});

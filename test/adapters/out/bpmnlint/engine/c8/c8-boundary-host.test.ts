import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-boundary-host.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const COMPENSATION = (handlerAttributes: string) => `
  <bpmn:serviceTask id="serviceTask_chargeCard">
    <bpmn:extensionElements><zeebe:taskDefinition type="charge-card" /></bpmn:extensionElements>
  </bpmn:serviceTask>
  <bpmn:boundaryEvent id="boundaryEvent_compensate" attachedToRef="serviceTask_chargeCard">
    <bpmn:compensateEventDefinition id="compensateEventDefinition_compensate" />
  </bpmn:boundaryEvent>
  <bpmn:serviceTask id="serviceTask_refundCard" ${handlerAttributes}>
    <bpmn:extensionElements><zeebe:taskDefinition type="refund-card" /></bpmn:extensionElements>
  </bpmn:serviceTask>
  <bpmn:boundaryEvent id="boundaryEvent_refundTimeout" attachedToRef="serviceTask_refundCard">
    <bpmn:timerEventDefinition id="timerEventDefinition_refundTimeout">
      <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration>
    </bpmn:timerEventDefinition>
  </bpmn:boundaryEvent>
  <bpmn:association id="association_compensate" associationDirection="One"
      sourceRef="boundaryEvent_compensate" targetRef="serviceTask_refundCard" />`;

verifyEngineRule('c8-boundary-host', rule, {
  valid: [
    {
      name: 'a boundary event on a normal activity',
      moddleElement: engineModel('c8', COMPENSATION('')),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel(
        'c7',
        COMPENSATION('isForCompensation="true"').replace(
          /<bpmn:extensionElements>.*?<\/bpmn:extensionElements>/g,
          '',
        ),
      ),
    },
  ],
  invalid: [
    {
      name: 'a boundary event on a compensation handler',
      moddleElement: engineModel('c8', COMPENSATION('isForCompensation="true"')),
      report: {
        id: 'boundaryEvent_refundTimeout',
        message:
          'Boundary event boundaryEvent_refundTimeout is attached to the compensation handler serviceTask_refundCard; Camunda 8 refuses boundary events on compensation handlers',
        path: ['attachedToRef'],
        type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
      },
    },
  ],
});

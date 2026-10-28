import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-boundary-host.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const COMPENSATION = (
  handlerAttributes: string,
  implementation = 'camunda:expression="${true}"',
) => `
  <bpmn:serviceTask id="serviceTask_chargeCard" ${implementation} />
  <bpmn:boundaryEvent id="boundaryEvent_compensate" attachedToRef="serviceTask_chargeCard">
    <bpmn:compensateEventDefinition id="compensateEventDefinition_compensate" />
  </bpmn:boundaryEvent>
  <bpmn:serviceTask id="serviceTask_refundCard" ${implementation} ${handlerAttributes} />
  <bpmn:boundaryEvent id="boundaryEvent_refundTimeout" attachedToRef="serviceTask_refundCard">
    <bpmn:timerEventDefinition id="timerEventDefinition_refundTimeout">
      <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration>
    </bpmn:timerEventDefinition>
  </bpmn:boundaryEvent>
  <bpmn:association id="association_compensate" associationDirection="One"
      sourceRef="boundaryEvent_compensate" targetRef="serviceTask_refundCard" />`;

verifyEngineRule('c7-boundary-host', rule, {
  valid: [
    {
      name: 'a boundary event on a normal activity',
      moddleElement: engineModel('c7', COMPENSATION('')),
    },
    {
      name: 'a boundary event on a compensation handler in a non-executable process',
      moddleElement: engineModel('c7', COMPENSATION('isForCompensation="true"'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a boundary event on a compensation handler in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="adHocSubProcess_refund">${COMPENSATION('isForCompensation="true"')}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', COMPENSATION('isForCompensation="true"', '')),
    },
  ],
  invalid: [
    {
      name: 'a boundary event on a compensation handler',
      moddleElement: engineModel('c7', COMPENSATION('isForCompensation="true"')),
      report: {
        id: 'boundaryEvent_refundTimeout',
        message:
          'Boundary event boundaryEvent_refundTimeout is attached to the compensation handler serviceTask_refundCard; the engines refuse boundary events on compensation handlers',
        path: ['attachedToRef'],
        type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
      },
    },
  ],
});

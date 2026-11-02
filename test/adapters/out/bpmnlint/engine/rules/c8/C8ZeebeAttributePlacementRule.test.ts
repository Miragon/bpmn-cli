import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8ZeebeAttributePlacementRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-zeebe-attribute-placement', () => {
  const LANES = (attributes: string) =>
    `<bpmn:laneSet id="laneSet_order"><bpmn:lane id="lane_sales" ${attributes} /></bpmn:laneSet>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'zeebe attributes on the elements that carry them',
        moddleElement: engineModel(
          'c8',
          `<bpmn:serviceTask id="serviceTask_charge" zeebe:modelerTemplate="io.example.charge" zeebe:retryCounter="3">
            <bpmn:extensionElements><zeebe:taskDefinition type="charge" /></bpmn:extensionElements>
          </bpmn:serviceTask>
          <bpmn:receiveTask id="receiveTask_paid" messageRef="message_paid" />`,
          {
            roots:
              '<bpmn:message id="message_paid" name="paid" zeebe:modelerTemplate="io.example.paid" />',
          },
        ),
      },
      {
        name: 'an unknown zeebe attribute (c8-zeebe-attribute-known reports it)',
        moddleElement: engineModel('c8', LANES('zeebe:foo="x"')),
      },
      {
        name: 'a misplaced zeebe attribute in a non-executable process',
        moddleElement: engineModel('c8', LANES('zeebe:modelerTemplate="x"'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', LANES('camunda:asyncBefore="true"')),
      },
    ],
    invalid: [
      {
        name: 'a template on a lane',
        moddleElement: engineModel('c8', LANES('zeebe:modelerTemplate="io.example.sales"')),
        report: {
          id: 'lane_sales',
          message:
            'zeebe:modelerTemplate on lane lane_sales has no effect: Camunda 8 reads it on collaboration, process, flowElement, error, escalation, message, signal only',
          path: ['zeebe:modelerTemplate'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'a retry counter on a user task',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_review" zeebe:retryCounter="3"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_review',
          message:
            'zeebe:retryCounter on userTask userTask_review has no effect: Camunda 8 reads it on serviceTask, businessRuleTask, scriptTask, sendTask, endEvent, intermediateThrowEvent, adHocSubProcess only',
          path: ['zeebe:retryCounter'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

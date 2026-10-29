import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7NoZeebeContentRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-no-zeebe-content', () => {
  const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const task = (attributes: string, inner = '') =>
    `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}" ${attributes}>${inner}</bpmn:serviceTask>`;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a zeebe attribute in a non-executable process (the engines skip it)',
        moddleElement: engineModel('c7', task('zeebe:retries="3"'), {
          definitionsAttributes: ZEEBE,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'camunda content only',
        moddleElement: engineModel('c7', task('camunda:asyncBefore="true"')),
      },
      {
        name: 'zeebe content inside an extension element the engines do not read there',
        moddleElement: engineModel(
          'c7',
          task('', ext('<camunda:taskListener event="create" class="a.B" zeebe:retries="3" />')),
          {
            definitionsAttributes: ZEEBE,
          },
        ),
      },
      {
        name: 'zeebe content inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps" zeebe:retries="3">${task('zeebe:retries="3"')}</bpmn:adHocSubProcess>`,
          {
            definitionsAttributes: ZEEBE,
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="serviceTask_charge" zeebe:retries="3"><bpmn:extensionElements><zeebe:taskDefinition type="charge" /></bpmn:extensionElements></bpmn:serviceTask>',
        ),
      },
    ],
    invalid: [
      {
        name: 'a zeebe attribute and a zeebe extension element on a task',
        moddleElement: engineModel(
          'c7',
          task('zeebe:retries="3"', ext('<zeebe:taskDefinition type="x" />')),
          {
            definitionsAttributes: ZEEBE,
          },
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'serviceTask serviceTask_charge carries the Camunda 8 attribute zeebe:retries, which Camunda 7 ignores',
            path: ['zeebe:retries'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'serviceTask serviceTask_charge contains the Camunda 8 extension zeebe:taskDefinition, which Camunda 7 ignores',
            path: ['extensionElements', 'values', 0],
            type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'zeebe attributes on camunda extension elements, nested ones included',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${ext('<camunda:inputOutput zeebe:foo="1"><camunda:inputParameter name="a" zeebe:bar="2">1</camunda:inputParameter></camunda:inputOutput>')}</bpmn:userTask>`,
          { definitionsAttributes: ZEEBE },
        ),
        report: [
          {
            id: 'userTask_review',
            message:
              'camunda:inputOutput of userTask userTask_review carries the Camunda 8 attribute zeebe:foo, which Camunda 7 ignores',
            path: ['extensionElements', 'values', 0, 'zeebe:foo'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'userTask_review',
            message:
              'camunda:inputParameter (in camunda:inputOutput) of userTask userTask_review carries the Camunda 8 attribute zeebe:bar, which Camunda 7 ignores',
            path: ['extensionElements', 'values', 0, 'inputParameters', 0, 'zeebe:bar'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a zeebe attribute on an event definition, reported on its event',
        moddleElement: engineModel(
          'c7',
          '<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait"><bpmn:timerEventDefinition zeebe:foo="1"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
          { definitionsAttributes: ZEEBE },
        ),
        report: {
          id: 'intermediateCatchEvent_wait',
          message:
            'the timerEventDefinition of intermediateCatchEvent:timer intermediateCatchEvent_wait carries the Camunda 8 attribute zeebe:foo, which Camunda 7 ignores',
          path: ['eventDefinitions', 0, 'zeebe:foo'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

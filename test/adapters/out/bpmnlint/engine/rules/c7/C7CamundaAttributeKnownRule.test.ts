import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7CamundaAttributeKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-camunda-attribute-known', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TIMER =
    '<bpmn:timerEventDefinition id="timerEventDefinition_wait"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a typo in a non-executable process (the engines skip it)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:asignee="demo" />',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'known camunda attributes and extension elements',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review" camunda:assignee="demo">${ext('<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>')}</bpmn:userTask>`,
        ),
      },
      {
        name: 'a known camunda attribute on an element it does not apply to (c7-camunda-attribute-placement)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:assignee="demo" />',
        ),
      },
      {
        name: 'an unknown attribute inside an extension element the engines do not read there',
        moddleElement: engineModel(
          'c7',
          `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}">${ext('<camunda:taskListener event="create" class="a.B" foo="1" />')}</bpmn:serviceTask>`,
        ),
      },
      {
        name: 'an unknown attribute inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_steps"><bpmn:userTask id="userTask_review" camunda:asignee="demo" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'an attribute without prefix (c7-schema)',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_review" asignee="demo" />'),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:userTask id="userTask_review" />'),
      },
    ],
    invalid: [
      {
        name: 'a typo on a user task',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:asignee="demo" />',
        ),
        report: {
          id: 'userTask_review',
          message:
            'userTask userTask_review has the unknown attribute camunda:asignee (did you mean camunda:assignee?); the engines ignore it',
          path: ['camunda:asignee'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'a typo of an attribute of another element type, on an event definition',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait"><bpmn:messageEventDefinition id="messageEventDefinition_wait" messageRef="message_paid" camunda:asyncc="true" />${TIMER}</bpmn:intermediateCatchEvent>`,
          { roots: '<bpmn:message id="message_paid" name="paid" />' },
        ),
        report: {
          id: 'intermediateCatchEvent_wait',
          message:
            'messageEventDefinition messageEventDefinition_wait has the unknown attribute camunda:asyncc (did you mean camunda:async? It applies to activity, gateway, event, multiInstanceLoopCharacteristics, ... only.); the engines ignore it',
          path: ['eventDefinitions', 0, 'camunda:asyncc'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'an unknown attribute far from every known one',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:somethingElse="1" />',
        ),
        report: {
          id: 'userTask_review',
          message:
            'userTask userTask_review has the unknown attribute camunda:somethingElse; the engines ignore it',
          path: ['camunda:somethingElse'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'unknown attributes on camunda extension elements, nested ones included',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${ext('<camunda:inputOutput><camunda:inputParameter name="a" nme="b" foo="1">1</camunda:inputParameter></camunda:inputOutput><camunda:executionListener event="start" clas="a.B" expression="${x}" />')}</bpmn:userTask>`,
        ),
        report: [
          {
            id: 'userTask_review',
            message:
              'camunda:inputParameter (in camunda:inputOutput) of userTask userTask_review has the unknown attribute nme (did you mean name?); the engines ignore it',
            path: ['extensionElements', 'values', 0, 'inputParameters', 0, 'nme'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'userTask_review',
            message:
              'camunda:inputParameter (in camunda:inputOutput) of userTask userTask_review has the unknown attribute foo; the engines ignore it',
            path: ['extensionElements', 'values', 0, 'inputParameters', 0, 'foo'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'userTask_review',
            message:
              'camunda:executionListener of userTask userTask_review has the unknown attribute clas (did you mean class?); the engines ignore it',
            path: ['extensionElements', 'values', 1, 'clas'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
        ],
      },
    ],
  });
});

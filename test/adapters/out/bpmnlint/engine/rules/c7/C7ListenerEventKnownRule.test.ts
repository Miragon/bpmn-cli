import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ListenerEventKnownRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-listener-event-known', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const userTask = (inner: string) =>
    `<bpmn:userTask id="userTask_review">${ext(inner)}</bpmn:userTask>`;
  const serviceTask = (inner: string) =>
    `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}">${ext(inner)}</bpmn:serviceTask>`;
  const timeout = (attributes: string, inner = TIMER) =>
    userTask(
      `<camunda:taskListener event="timeout" expression="\${true}" ${attributes}>${inner}</camunda:taskListener>`,
    );
  const REQUIRED = ERROR_TYPES.PROPERTY_REQUIRED;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'listeners with an implementation and a known event',
        moddleElement: engineModel(
          'c7',
          serviceTask(
            '<camunda:executionListener event="start" class="a.B" /><camunda:executionListener event="end"><camunda:script scriptFormat="groovy">x</camunda:script></camunda:executionListener>',
          ) + userTask('<camunda:taskListener event="assignment" delegateExpression="${l}" />'),
        ),
      },
      {
        name: 'a timeout task listener with timer and id',
        moddleElement: engineModel('c7', timeout('id="taskListener_remind"')),
      },
      {
        name: 'a timeout task listener with an empty id',
        moddleElement: engineModel('c7', timeout('id=""')),
      },
      {
        name: 'an execution listener on a sequence flow takes any event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review" /><bpmn:endEvent id="endEvent_done" /><bpmn:sequenceFlow id="flow_done" sourceRef="userTask_review" targetRef="endEvent_done">${ext('<camunda:executionListener class="a.B" />')}</bpmn:sequenceFlow>`,
        ),
      },
      {
        name: 'a task listener where the engines do not read it (c7-camunda-extension-placement)',
        moddleElement: engineModel('c7', serviceTask('<camunda:taskListener event="nope" />')),
      },
      {
        name: 'a listener in a non-executable process',
        moddleElement: engineModel('c7', serviceTask('<camunda:executionListener event="start" />'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a listener inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${serviceTask('<camunda:executionListener event="start" />')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:userTask id="userTask_review" />'),
      },
    ],
    invalid: [
      {
        name: 'an execution listener with event take on a task',
        moddleElement: engineModel(
          'c7',
          serviceTask('<camunda:executionListener event="take" class="a.B" />'),
        ),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:executionListener (event take) of serviceTask serviceTask_charge: event "take" is not one of start, end; the engines refuse the file',
          path: ['extensionElements', 'values', 0, 'event'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'an execution listener with an unknown event next to a valid one',
        moddleElement: engineModel(
          'c7',
          userTask(
            '<camunda:executionListener event="end" expression="${a}" /><camunda:executionListener event="finish" expression="${b}" />',
          ),
        ),
        report: {
          id: 'userTask_review',
          message:
            'camunda:executionListener (event finish) of userTask userTask_review: event "finish" is not one of start, end; the engines refuse the file',
          path: ['extensionElements', 'values', 1, 'event'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'a task listener without event',
        moddleElement: engineModel('c7', userTask('<camunda:taskListener class="a.B" />')),
        report: {
          id: 'userTask_review',
          message:
            'camunda:taskListener of userTask userTask_review has no event; the engines refuse the file',
          path: ['extensionElements', 'values', 0, 'event'],
          type: REQUIRED,
        },
      },
    ],
  });
});

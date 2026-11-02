import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8EmbeddedStartEventNoTriggerRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-embedded-start-event-no-trigger', () => {
  const TIMER =
    '<bpmn:timerEventDefinition id="timer_YS"><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition>';
  const chain = (...middle: string[]) => `
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
    ${middle.join('\n')}
    <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
    <bpmn:endEvent id="End" />`;
  const inner = (prefix: string, start = '') =>
    `<bpmn:startEvent id="${prefix}S">${start}</bpmn:startEvent><bpmn:sequenceFlow id="${prefix}F" sourceRef="${prefix}S" targetRef="${prefix}E" /><bpmn:endEvent id="${prefix}E" />`;
  const TIMER_START = chain(`<bpmn:subProcess id="X">${inner('Y', TIMER)}</bpmn:subProcess>`);

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a sub-process with one none start event',
        moddleElement: engineModel(
          'c8',
          chain(`<bpmn:subProcess id="X">${inner('I')}</bpmn:subProcess>`),
        ),
      },
      {
        name: 'an event sub-process with a timer start event',
        moddleElement: engineModel(
          'c8',
          chain(
            '<bpmn:task id="X" />',
            `<bpmn:subProcess id="ESP" triggeredByEvent="true">${inner('Y', TIMER)}</bpmn:subProcess>`,
          ),
        ),
      },
      {
        name: 'a sub-process without start event (bpmnlint start-event-required)',
        moddleElement: engineModel(
          'c8',
          chain('<bpmn:subProcess id="X"><bpmn:task id="A1" /></bpmn:subProcess>'),
        ),
      },
      {
        name: 'two none start events in a process (camunda-compat no-multiple-none-start-events)',
        moddleElement: engineModel(
          'c8',
          `${chain('<bpmn:task id="X" />')}<bpmn:startEvent id="S2" /><bpmn:sequenceFlow id="F9" sourceRef="S2" targetRef="End" />`,
        ),
      },
      {
        name: 'start events in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c8',
          chain(
            `<bpmn:adHocSubProcess id="X"><bpmn:startEvent id="AS">${TIMER}</bpmn:startEvent><bpmn:startEvent id="AS2" /></bpmn:adHocSubProcess>`,
          ),
        ),
      },
      {
        name: 'a timer start in a sub-process of a process that is not executable',
        moddleElement: engineModel('c8', TIMER_START, { processAttributes: 'isExecutable="false"' }),
      },
      { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', TIMER_START) },
    ],
    invalid: [
      {
        name: 'a sub-process with a timer start event',
        moddleElement: engineModel('c8', TIMER_START),
        report: {
          id: 'YS',
          message:
            'Start event YS of sub-process X has a timer trigger; Camunda 8 allows only a none start event in an embedded sub-process and refuses the file',
          path: ['eventDefinitions', 0],
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        },
      },
    ],
  });
});

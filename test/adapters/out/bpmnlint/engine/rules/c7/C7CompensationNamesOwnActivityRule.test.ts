import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7CompensationNamesOwnActivityRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-compensation-names-own-activity', () => {
  const ROOTS = '<bpmn:message id="M" name="Pay" />';
  const TIMER =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const EMPTY_TIMER = '<bpmn:timerEventDefinition id="TDef" />';
  const TWO_TIMES =
    '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDate xsi:type="bpmn:tFormalExpression">2030-01-01T00:00:00Z</bpmn:timeDate><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const COND_NONE = '<bpmn:conditionalEventDefinition id="CDef" />';
  const MSG = '<bpmn:messageEventDefinition id="MDef" messageRef="M" />';
  const START = '<bpmn:startEvent id="Start" />';
  const catchWith = (defs: string) =>
    `${START}<bpmn:intermediateCatchEvent id="W">${defs}</bpmn:intermediateCatchEvent>`;
  const eventSubStart = (defs: string) =>
    `${START}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="W" isInterrupting="false">${defs}</bpmn:startEvent></bpmn:subProcess>`;
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const compensation = (ref: string, where: 'process' | 'sub' | 'end' | 'eventSub' = 'process') => {
    const thr = `<bpmn:intermediateThrowEvent id="Th"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:intermediateThrowEvent>`;
    const sub = `<bpmn:subProcess id="Sub"><bpmn:startEvent id="SS" /><bpmn:userTask id="Inner" />${where === 'sub' ? thr : ''}</bpmn:subProcess>`;
    const end =
      where === 'end'
        ? `<bpmn:endEvent id="End"><bpmn:compensateEventDefinition activityRef="${ref}" /></bpmn:endEvent>`
        : '<bpmn:endEvent id="End" />';
    const eventSub =
      where === 'eventSub'
        ? `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false">${MSG}</bpmn:startEvent>${thr}</bpmn:subProcess>`
        : '';
    return engineModel(
      'c7',
      `${START}<bpmn:userTask id="Host" />${sub}${where === 'process' ? thr : ''}${end}${eventSub}${flow('F0', 'Start', 'Host')}`,
      { roots: ROOTS },
    );
  };
  const compensationReport = (id: string, named: string) => ({
    id,
    message: `Compensation event ${id} names activityRef ${named}; the engines compensate only activities of the throw event's own (sub-)process and refuse the file`,
    path: ['eventDefinitions', 0, 'activityRef'],
    type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a timer with a duration and a conditional event with a condition',
        moddleElement: engineModel(
          'c7',
          catchWith(TIMER) +
            '<bpmn:intermediateCatchEvent id="C"><bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression">${ready}</bpmn:condition></bpmn:conditionalEventDefinition></bpmn:intermediateCatchEvent>',
        ),
      },
      {
        name: 'event sub-process start: the message acts, an empty timer is ignored',
        moddleElement: engineModel('c7', eventSubStart(MSG + EMPTY_TIMER), { roots: ROOTS }),
      },
      {
        name: 'a timer without value in a non-executable process',
        moddleElement: engineModel('c7', catchWith(EMPTY_TIMER), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a timer without value in an ad-hoc sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="AH">${catchWith(EMPTY_TIMER)}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'compensation of the sub-process from its own scope',
        moddleElement: compensation('Sub'),
      },
      {
        name: 'compensation of an activity of the own scope',
        moddleElement: compensation('Host'),
      },
      {
        name: 'compensation from an event sub-process of an activity of its parent scope',
        moddleElement: compensation('Host', 'eventSub'),
      },
      {
        name: 'compensation inside a sub-process of its own activity',
        moddleElement: compensation('Inner', 'sub'),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel(
          'c8',
          catchWith(COND_NONE) +
            `<bpmn:intermediateCatchEvent id="T">${TWO_TIMES}</bpmn:intermediateCatchEvent>`,
        ),
      },
    ],
    invalid: [
      {
        name: 'compensation of an activity inside a sub-process from the process',
        moddleElement: compensation('Inner'),
        report: compensationReport('Th', 'userTask Inner, which is not in process_test'),
      },
      {
        name: 'compensation end event naming an activity inside a sub-process',
        moddleElement: compensation('Inner', 'end'),
        report: compensationReport('End', 'userTask Inner, which is not in process_test'),
      },
      {
        name: 'compensation of a process activity from inside a sub-process',
        moddleElement: compensation('Host', 'sub'),
        report: compensationReport('Th', 'userTask Host, which is not in Sub'),
      },
      {
        name: 'compensation naming a sequence flow',
        moddleElement: compensation('F0'),
        report: compensationReport('Th', 'F0, which is not a flow node'),
      },
    ],
  });
});

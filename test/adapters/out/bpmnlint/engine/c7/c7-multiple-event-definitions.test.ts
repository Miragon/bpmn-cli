import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-multiple-event-definitions.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const ROOTS = '<bpmn:message id="M" name="Pay" /><bpmn:signal id="Sig" name="Go" />';
const TIMER =
  '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const MSG = '<bpmn:messageEventDefinition id="MDef" messageRef="M" />';
const MSG_NOREF = '<bpmn:messageEventDefinition id="MDef" />';
const SIGNAL = '<bpmn:signalEventDefinition signalRef="Sig" />';
const LINK = '<bpmn:linkEventDefinition id="LDef" name="L" />';
const COND =
  '<bpmn:conditionalEventDefinition id="CDef"><bpmn:condition xsi:type="bpmn:tFormalExpression">${false}</bpmn:condition></bpmn:conditionalEventDefinition>';
const ESCALATION = '<bpmn:escalationEventDefinition escalationRef="Esc" />';

const START = '<bpmn:startEvent id="Start" />';
const catchEvent = (defs: string) =>
  `${START}<bpmn:intermediateCatchEvent id="W">${defs}</bpmn:intermediateCatchEvent>`;
const eventSub = (defs: string) =>
  `${START}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES_S" isInterrupting="false">${defs}</bpmn:startEvent></bpmn:subProcess>`;
const boundary = (defs: string) =>
  `${START}<bpmn:userTask id="U" /><bpmn:boundaryEvent id="B" attachedToRef="U">${defs}</bpmn:boundaryEvent>`;
const endEvent = (defs: string) => `${START}<bpmn:endEvent id="End">${defs}</bpmn:endEvent>`;
const throwEvent = (defs: string) =>
  `${START}<bpmn:intermediateThrowEvent id="T">${defs}</bpmn:intermediateThrowEvent>`;

const report = (id: string, message: string) => ({
  id,
  message,
  path: ['eventDefinitions'],
  type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
});

verifyEngineRule('c7-multiple-event-definitions', rule, {
  valid: [
    {
      name: 'one event definition per event',
      moddleElement: engineModel('c7', catchEvent(TIMER) + boundary(MSG), { roots: ROOTS }),
    },
    {
      name: 'several definitions in a non-executable process',
      moddleElement: engineModel('c7', catchEvent(MSG + TIMER), {
        roots: ROOTS,
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'several definitions in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${catchEvent(MSG + TIMER)}</bpmn:adHocSubProcess>`,
        { roots: ROOTS },
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', catchEvent(MSG + TIMER), { roots: ROOTS }),
    },
  ],
  invalid: [
    {
      name: 'message + timer catch event: the timer acts',
      moddleElement: engineModel('c7', catchEvent(MSG + TIMER), { roots: ROOTS }),
      report: report(
        'W',
        'intermediateCatchEvent:message W has 2 event definitions (message, timer); the engines act on the timer only and ignore the message',
      ),
    },
    {
      name: 'timer + a message without messageRef',
      moddleElement: engineModel('c7', catchEvent(TIMER + MSG_NOREF)),
      report: report(
        'W',
        'intermediateCatchEvent:timer W has 2 event definitions (timer, message); the engines act on the timer only and ignore the message',
      ),
    },
    {
      name: 'event sub-process start: the message acts',
      moddleElement: engineModel('c7', eventSub(TIMER + MSG), { roots: ROOTS }),
      report: report(
        'ES_S',
        'startEvent:timer ES_S has 2 event definitions (timer, message); the engines act on the message only and ignore the timer',
      ),
    },
    {
      name: 'process start event: message + timer, the timer acts',
      moddleElement: engineModel(
        'c7',
        `<bpmn:startEvent id="S2">${MSG}${TIMER}</bpmn:startEvent>`,
        { roots: ROOTS },
      ),
      report: report(
        'S2',
        'startEvent:message S2 has 2 event definitions (message, timer); the engines act on the timer only and ignore the message',
      ),
    },
    {
      name: 'boundary event: message + signal, the signal acts',
      moddleElement: engineModel('c7', boundary(MSG + SIGNAL), { roots: ROOTS }),
      report: report(
        'B',
        'boundaryEvent:message B has 2 event definitions (message, signal); the engines act on the signal only and ignore the message',
      ),
    },
    {
      name: 'end event: message + signal, the message acts',
      moddleElement: engineModel(
        'c7',
        endEvent('<bpmn:messageEventDefinition camunda:expression="${true}" />' + SIGNAL),
        { roots: ROOTS },
      ),
      report: report(
        'End',
        'endEvent:message End has 2 event definitions (message, signal); the engines act on the message only and ignore the signal',
      ),
    },
    {
      name: 'intermediate throw event: signal + message, the signal acts',
      moddleElement: engineModel(
        'c7',
        throwEvent(
          '<bpmn:signalEventDefinition /><bpmn:messageEventDefinition camunda:expression="${true}" />',
        ),
      ),
      report: report(
        'T',
        'intermediateThrowEvent:signal T has 2 event definitions (signal, message); the engines act on the signal only and ignore the message',
      ),
    },
    {
      name: 'link + timer catch event: the timer acts',
      moddleElement: engineModel('c7', catchEvent(LINK + TIMER)),
      report: report(
        'W',
        'intermediateCatchEvent:link W has 2 event definitions (link, timer); the engines act on the timer only and ignore the link',
      ),
    },
    {
      name: 'link + conditional catch event: the link acts',
      moddleElement: engineModel('c7', catchEvent(LINK + COND)),
      report: report(
        'W',
        'intermediateCatchEvent:link W has 2 event definitions (link, conditional); the engines act on the link only and ignore the conditional',
      ),
    },
    {
      name: 'a pair whose order is not known',
      moddleElement: engineModel('c7', boundary(TIMER + ESCALATION), {
        roots: '<bpmn:escalation id="Esc" escalationCode="E" />',
      }),
      report: report(
        'B',
        'boundaryEvent:timer B has 2 event definitions (timer, escalation); the engines act on one of them only and ignore the others',
      ),
    },
  ],
});

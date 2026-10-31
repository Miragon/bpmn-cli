import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7CamundaAttributePlacementRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-camunda-attribute-placement', () => {
  const ROOTS = `<bpmn:message id="message_paid" name="paid" /><bpmn:signal id="signal_go" name="go" />
    <bpmn:escalation id="escalation_late" name="late" escalationCode="E1" /><bpmn:error id="error_failed" name="failed" errorCode="E1" />`;
  const TIMER = (attributes = '') =>
    `<bpmn:timerEventDefinition id="timerEventDefinition_wait" ${attributes}><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>`;
  const PROPERTY_NOT_ALLOWED = ERROR_TYPES.PROPERTY_NOT_ALLOWED;

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'a misplaced attribute in a non-executable process (the engines skip it)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:assignee="demo" />',
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'attributes where the engines read them',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review" camunda:assignee="demo"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item" /></bpmn:userTask>
           <bpmn:intermediateThrowEvent id="intermediateThrowEvent_notify"><bpmn:messageEventDefinition messageRef="message_paid" camunda:class="a.B" /></bpmn:intermediateThrowEvent>
           <bpmn:boundaryEvent id="boundaryEvent_failed" attachedToRef="userTask_review"><bpmn:errorEventDefinition errorRef="error_failed" camunda:errorCodeVariable="code" /></bpmn:boundaryEvent>`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a signal catch event definition without camunda:async (its default does not count)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:intermediateCatchEvent id="intermediateCatchEvent_go"><bpmn:signalEventDefinition signalRef="signal_go" /></bpmn:intermediateCatchEvent>',
          { roots: ROOTS },
        ),
      },
      {
        name: 'an unknown camunda attribute (c7-camunda-attribute-known)',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:asignee="demo" />',
        ),
      },
      {
        name: 'a misplaced attribute inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          '<bpmn:adHocSubProcess id="adHocSubProcess_steps"><bpmn:serviceTask id="serviceTask_charge" camunda:assignee="demo" /></bpmn:adHocSubProcess>',
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
      },
    ],
    invalid: [
      {
        name: 'camunda:assignee on a service task',
        moddleElement: engineModel(
          'c7',
          '<bpmn:serviceTask id="serviceTask_charge" camunda:expression="${true}" camunda:assignee="demo" />',
        ),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:assignee on serviceTask serviceTask_charge has no effect: the engines read it on userTask only',
          path: ['camunda:assignee'],
          type: PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'the multi-instance collection on the activity instead of the loop',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:collection="${items}" camunda:elementVariable="item"><bpmn:multiInstanceLoopCharacteristics /></bpmn:userTask>',
        ),
        report: [
          {
            id: 'userTask_review',
            message:
              'camunda:collection on userTask userTask_review has no effect: the engines read it on multiInstanceLoopCharacteristics only',
            path: ['camunda:collection'],
            type: PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'userTask_review',
            message:
              'camunda:elementVariable on userTask userTask_review has no effect: the engines read it on multiInstanceLoopCharacteristics only',
            path: ['camunda:elementVariable'],
            type: PROPERTY_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'errorCodeVariable on the event instead of its definition',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" /><bpmn:boundaryEvent id="boundaryEvent_failed" attachedToRef="userTask_review" camunda:errorCodeVariable="code"><bpmn:errorEventDefinition errorRef="error_failed" /></bpmn:boundaryEvent>',
          { roots: ROOTS },
        ),
        report: {
          id: 'boundaryEvent_failed',
          message:
            'camunda:errorCodeVariable on boundaryEvent:error boundaryEvent_failed has no effect: the engines read it on errorEventDefinition only',
          path: ['camunda:errorCodeVariable'],
          type: PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'a job priority on a timer definition, reported on its event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait">${TIMER('camunda:jobPriority="high"')}</bpmn:intermediateCatchEvent>`,
        ),
        report: {
          id: 'intermediateCatchEvent_wait',
          message:
            'camunda:jobPriority on timerEventDefinition timerEventDefinition_wait has no effect: the engines read it on process, activity, gateway, event, ... only',
          path: ['eventDefinitions', 0, 'camunda:jobPriority'],
          type: PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'throw-only and catch-only settings on the wrong side',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_paid"><bpmn:messageEventDefinition messageRef="message_paid" camunda:type="external" camunda:topic="t" /></bpmn:intermediateCatchEvent>
           <bpmn:intermediateCatchEvent id="intermediateCatchEvent_go"><bpmn:signalEventDefinition signalRef="signal_go" camunda:async="false" /></bpmn:intermediateCatchEvent>
           <bpmn:intermediateThrowEvent id="intermediateThrowEvent_late"><bpmn:escalationEventDefinition escalationRef="escalation_late" camunda:escalationCodeVariable="c" /></bpmn:intermediateThrowEvent>
           <bpmn:endEvent id="endEvent_failed"><bpmn:errorEventDefinition errorRef="error_failed" camunda:errorCodeVariable="c" /></bpmn:endEvent>`,
          { roots: ROOTS },
        ),
        report: [
          {
            id: 'intermediateCatchEvent_paid',
            message:
              'camunda:type on the messageEventDefinition of intermediateCatchEvent:message intermediateCatchEvent_paid has no effect: the engines read it on message throw and end events only',
            path: ['eventDefinitions', 0, 'camunda:type'],
            type: PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'intermediateCatchEvent_paid',
            message:
              'camunda:topic on the messageEventDefinition of intermediateCatchEvent:message intermediateCatchEvent_paid has no effect: the engines read it on message throw and end events only',
            path: ['eventDefinitions', 0, 'camunda:topic'],
            type: PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'intermediateCatchEvent_go',
            message:
              'camunda:async on the signalEventDefinition of intermediateCatchEvent:signal intermediateCatchEvent_go has no effect: the engines read it on signal throw and end events only',
            path: ['eventDefinitions', 0, 'camunda:async'],
            type: PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'intermediateThrowEvent_late',
            message:
              'camunda:escalationCodeVariable on the escalationEventDefinition of intermediateThrowEvent:escalation intermediateThrowEvent_late has no effect: the engines read it on escalation boundary and escalation start events only',
            path: ['eventDefinitions', 0, 'camunda:escalationCodeVariable'],
            type: PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'endEvent_failed',
            message:
              'camunda:errorCodeVariable on the errorEventDefinition of endEvent:error endEvent_failed has no effect: the engines read it on error boundary and error start events only',
            path: ['eventDefinitions', 0, 'camunda:errorCodeVariable'],
            type: PROPERTY_NOT_ALLOWED,
          },
        ],
      },
    ],
  });
});

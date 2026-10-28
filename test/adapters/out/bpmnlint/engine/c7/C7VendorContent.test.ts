import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import { C7Diagram } from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7Diagram.js';
import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7VendorContent.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

describe('c7-foreign-content', () => {
  const ZEEBE = 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"';
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const task = (attributes: string, inner = '') =>
    `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}" ${attributes}>${inner}</bpmn:serviceTask>`;

  verifyEngineRule('c7-foreign-content', rule, {
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

describe('c7-unknown-attribute', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TIMER =
    '<bpmn:timerEventDefinition id="timerEventDefinition_wait"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';

  verifyEngineRule('c7-unknown-attribute', rule, {
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
        name: 'a known camunda attribute on an element it does not apply to (c7-misplaced-attribute)',
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

describe('c7-misplaced-attribute', () => {
  const ROOTS = `<bpmn:message id="message_paid" name="paid" /><bpmn:signal id="signal_go" name="go" />
    <bpmn:escalation id="escalation_late" name="late" escalationCode="E1" /><bpmn:error id="error_failed" name="failed" errorCode="E1" />`;
  const TIMER = (attributes = '') =>
    `<bpmn:timerEventDefinition id="timerEventDefinition_wait" ${attributes}><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>`;
  const PROPERTY_NOT_ALLOWED = ERROR_TYPES.PROPERTY_NOT_ALLOWED;

  verifyEngineRule('c7-misplaced-attribute', rule, {
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
        name: 'an unknown camunda attribute (c7-unknown-attribute)',
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

describe('c7-misplaced-extension', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const MAPPING =
    '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>';
  const RETRY = '<camunda:failedJobRetryTimeCycle>R3/PT1M</camunda:failedJobRetryTimeCycle>';
  const NOT_ALLOWED = ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED;
  const task = (inner: string) =>
    `<bpmn:serviceTask id="serviceTask_charge" camunda:expression="\${true}">${ext(inner)}</bpmn:serviceTask>`;
  const timerCatch = (definitionId: string) =>
    `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_wait"><bpmn:timerEventDefinition ${definitionId}>${ext(RETRY)}<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`;
  const RETRY_HOSTS = 'activity, gateway, event, multiInstanceLoopCharacteristics';

  verifyEngineRule('c7-misplaced-extension', rule, {
    valid: [
      {
        name: 'a misplaced extension element in a non-executable process (the engines skip it)',
        moddleElement: engineModel('c7', task('<camunda:formData />'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'extension elements where the engines read them',
        moddleElement: engineModel(
          'c7',
          `${ext('<camunda:executionListener event="start" class="a.B" /><camunda:potentialStarter />')}
           <bpmn:userTask id="userTask_review">${ext(`${MAPPING}<camunda:taskListener event="create" class="a.B" /><camunda:formData /><camunda:properties><camunda:property name="a" value="1" /></camunda:properties>`)}</bpmn:userTask>
           <bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="charge">${ext('<camunda:errorEventDefinition id="errorEventDefinition_failed" expression="${true}" />')}</bpmn:serviceTask>
           <bpmn:callActivity id="callActivity_ship" calledElement="ship">${ext('<camunda:in variables="all" /><camunda:out variables="all" />')}</bpmn:callActivity>`,
        ),
      },
      {
        name: 'a parameter loose in the extension elements (the typed parse drops it)',
        moddleElement: engineModel(
          'c7',
          task('<camunda:inputParameter name="a">x</camunda:inputParameter>'),
        ),
      },
      {
        name: 'a misplaced extension element inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${task('<camunda:formData />')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
      },
    ],
    invalid: [
      {
        name: 'a task listener, camunda:in and formData on a service task',
        moddleElement: engineModel(
          'c7',
          task(
            '<camunda:taskListener event="create" class="a.B" /><camunda:in variables="all" /><camunda:formData />',
          ),
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'camunda:taskListener on serviceTask serviceTask_charge has no effect: the engines read it on userTask only',
            path: ['extensionElements', 'values', 0],
            type: NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'camunda:in on serviceTask serviceTask_charge has no effect: the engines read it on callActivity, signalEventDefinition only',
            path: ['extensionElements', 'values', 1],
            type: NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'camunda:formData on serviceTask serviceTask_charge has no effect: the engines read it on startEvent, userTask only',
            path: ['extensionElements', 'values', 2],
            type: NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'camunda:inputOutput on the process',
        moddleElement: engineModel('c7', `${ext(MAPPING)}<bpmn:userTask id="userTask_review" />`),
        report: {
          id: 'process_test',
          message:
            'camunda:inputOutput on process process_test has no effect: the engines read it on flowNode, camunda:connector only',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'camunda:field on a message catch event definition',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateCatchEvent id="intermediateCatchEvent_paid"><bpmn:messageEventDefinition messageRef="message_paid">${ext('<camunda:field name="a" stringValue="x" />')}</bpmn:messageEventDefinition></bpmn:intermediateCatchEvent>`,
          { roots: '<bpmn:message id="message_paid" name="paid" />' },
        ),
        report: {
          id: 'intermediateCatchEvent_paid',
          message:
            'camunda:field on the messageEventDefinition of intermediateCatchEvent:message intermediateCatchEvent_paid has no effect: the engines read it on message throw and end events only',
          path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a retry cycle on a timer definition without an id',
        moddleElement: engineModel('c7', timerCatch('')),
        report: {
          id: 'intermediateCatchEvent_wait',
          message: `camunda:failedJobRetryTimeCycle on the timerEventDefinition of intermediateCatchEvent:timer intermediateCatchEvent_wait has no effect: the engines read it on ${RETRY_HOSTS} only`,
          path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a retry cycle on a timer definition with an id',
        moddleElement: engineModel('c7', timerCatch('id="timerEventDefinition_wait"')),
        report: {
          id: 'intermediateCatchEvent_wait',
          message: `camunda:failedJobRetryTimeCycle on timerEventDefinition timerEventDefinition_wait has no effect: the engines read it on ${RETRY_HOSTS} only`,
          path: ['eventDefinitions', 0, 'extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a task listener on a multi-instance loop (its retry cycle is read)',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review"><bpmn:multiInstanceLoopCharacteristics camunda:collection="\${items}" camunda:elementVariable="item">${ext(`${RETRY}<camunda:taskListener event="create" expression="\${x}" />`)}</bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>`,
        ),
        report: {
          id: 'userTask_review',
          message:
            'camunda:taskListener on the multiInstanceLoopCharacteristics of userTask userTask_review has no effect: the engines read it on userTask only',
          path: ['loopCharacteristics', 'extensionElements', 'values', 1],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a property loose in the extension elements',
        moddleElement: engineModel('c7', task('<camunda:property name="a" value="1" />')),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:property sits directly in the extension elements of serviceTask serviceTask_charge, but belongs inside camunda:properties; the engines ignore it',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c7-dangling-reference', () => {
  /** The model with the references its parse could not resolve recorded, as the engine run does before it lints. */
  const withUnresolvedReferences = (model: ReturnType<typeof engineModel>) =>
    model.then((parsed) => {
      C7Diagram.record(parsed.root, { operaton: false, prefix: 'camunda' }, parsed.warnings);
      return parsed;
    });

  const ROOTS =
    '<bpmn:error id="error_failed" name="failed" errorCode="E1" /><bpmn:message id="message_paid" name="paid" />';
  const task = (errorRef: string) =>
    `<bpmn:serviceTask id="serviceTask_charge" camunda:type="external" camunda:topic="charge"><bpmn:extensionElements><camunda:errorEventDefinition id="errorEventDefinition_failed" errorRef="${errorRef}" expression="\${true}" /></bpmn:extensionElements></bpmn:serviceTask>`;

  verifyEngineRule('c7-dangling-reference', rule, {
    valid: [
      {
        name: 'an errorRef to a message in a non-executable process (the engines skip it)',
        moddleElement: engineModel('c7', task('message_paid'), {
          roots: ROOTS,
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'an errorRef to a bpmn:Error',
        moddleElement: engineModel('c7', task('error_failed'), { roots: ROOTS }),
      },
      {
        name: 'an errorRef to no element the engine run has not handed over',
        moddleElement: engineModel('c7', task('error_gone'), { roots: ROOTS }),
      },
      {
        name: 'a dangling reference inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${task('message_paid')}</bpmn:adHocSubProcess>`,
          {
            roots: ROOTS,
          },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:serviceTask id="serviceTask_charge" />'),
      },
    ],
    invalid: [
      {
        name: 'an errorRef to no element (the typed parse drops it, the engine run hands it over)',
        moddleElement: withUnresolvedReferences(engineModel('c7', task('error_gone'), { roots: ROOTS })),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:errorEventDefinition of serviceTask serviceTask_charge references errorRef="error_gone", which is not a bpmn:Error in the file; the engines ignore the mapping when it runs',
          path: ['extensionElements', 'values', 0, 'errorRef'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
      {
        name: 'an errorRef to a message',
        moddleElement: engineModel('c7', task('message_paid'), { roots: ROOTS }),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:errorEventDefinition of serviceTask serviceTask_charge references errorRef="message_paid", which is not a bpmn:Error in the file; the engines ignore the mapping when it runs',
          path: ['extensionElements', 'values', 0, 'errorRef'],
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        },
      },
    ],
  });
});

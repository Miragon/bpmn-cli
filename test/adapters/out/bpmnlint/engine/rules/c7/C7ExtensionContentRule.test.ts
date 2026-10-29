import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ExtensionContentRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-extension', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const ROOTS =
    '<bpmn:signal id="signal_go" name="go" /><bpmn:message id="message_paid" name="paid" />';
  const FIELD_NEEDS =
    '(a field needs stringValue, expression, a camunda:string or a camunda:expression)';
  const REQUIRED = ERROR_TYPES.PROPERTY_REQUIRED;
  const callActivity = (inner: string) =>
    `<bpmn:callActivity id="callActivity_ship" calledElement="ship">${ext(inner)}</bpmn:callActivity>`;
  const serviceTask = (attributes: string, inner: string) =>
    `<bpmn:serviceTask id="serviceTask_charge" ${attributes}>${ext(inner)}</bpmn:serviceTask>`;
  const userTask = (inner: string) =>
    `<bpmn:userTask id="userTask_review">${ext(inner)}</bpmn:userTask>`;
  const report = (id: string, message: string, path: (string | number)[], type = REQUIRED) => ({
    id,
    message,
    path,
    type,
  });

  verifyEngineRule('c7-extension', rule, {
    valid: [
      {
        name: 'complete bindings, mappings, connector and form',
        moddleElement: engineModel(
          'c7',
          callActivity(
            '<camunda:in source="a" target="a" /><camunda:in sourceExpression="${b}" target="b" /><camunda:in businessKey="${key}" /><camunda:out variables="all" />',
          ) +
            serviceTask(
              'camunda:class="a.B"',
              '<camunda:field name="a" stringValue="x" /><camunda:field name="b"><camunda:string /></camunda:field><camunda:field name="c" expression="${c}" /><camunda:inputOutput><camunda:inputParameter name="p">1</camunda:inputParameter></camunda:inputOutput>',
            ) +
            '<bpmn:sendTask id="sendTask_notify"><bpmn:extensionElements><camunda:connector><camunda:connectorId>mail</camunda:connectorId></camunda:connector></bpmn:extensionElements></bpmn:sendTask>' +
            userTask(
              '<camunda:formData><camunda:formField id="a" type="string" /><camunda:formField id="b" type="date" /></camunda:formData>',
            ),
        ),
      },
      {
        name: 'fields the engines do not read: an expression or external implementation, an expression listener',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:expression="${true}"', '<camunda:field name="a" />') +
            serviceTask(
              'camunda:type="external" camunda:topic="charge"',
              '<camunda:field name="a" />',
            ).replace('serviceTask_charge', 'serviceTask_refund') +
            userTask(
              '<camunda:taskListener event="create" expression="${l}" delegateExpression="${d}"><camunda:field name="a" /></camunda:taskListener>',
            ),
        ),
      },
      {
        name: 'an incomplete binding where the engines do not read it (c7-misplaced-extension)',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:expression="${true}"', '<camunda:in source="a" />'),
        ),
      },
      {
        name: 'incomplete content in a non-executable process',
        moddleElement: engineModel('c7', callActivity('<camunda:in source="a" />'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'incomplete content inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps">${callActivity('<camunda:in source="a" />')}</bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'fields of a message definition the event does not act on',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateThrowEvent id="intermediateThrowEvent_notify"><bpmn:signalEventDefinition signalRef="signal_go" /><bpmn:messageEventDefinition messageRef="message_paid" camunda:class="a.B">${ext('<camunda:field name="a" />')}</bpmn:messageEventDefinition></bpmn:intermediateThrowEvent>`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:callActivity id="callActivity_ship" />'),
      },
    ],
    invalid: [
      {
        name: 'camunda:in with a source but no target',
        moddleElement: engineModel('c7', callActivity('<camunda:in source="a" />')),
        report: report(
          'callActivity_ship',
          'camunda:in of callActivity callActivity_ship has no target (and no variables="all" / businessKey); the engines refuse the file',
          ['extensionElements', 'values', 0, 'target'],
        ),
      },
      {
        name: 'camunda:out without source and target',
        moddleElement: engineModel('c7', callActivity('<camunda:out local="true" />')),
        report: report(
          'callActivity_ship',
          'camunda:out of callActivity callActivity_ship has no source or sourceExpression and target (and no variables="all"); the engines refuse the file',
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'camunda:in without target on a signal throw event definition',
        moddleElement: engineModel(
          'c7',
          `<bpmn:intermediateThrowEvent id="intermediateThrowEvent_go"><bpmn:signalEventDefinition signalRef="signal_go">${ext('<camunda:in source="a" target="a" /><camunda:in source="b" />')}</bpmn:signalEventDefinition></bpmn:intermediateThrowEvent>`,
          { roots: ROOTS },
        ),
        report: report(
          'intermediateThrowEvent_go',
          'camunda:in of the signalEventDefinition of intermediateThrowEvent:signal intermediateThrowEvent_go has no target (and no variables="all" / businessKey); the engines refuse the file',
          ['eventDefinitions', 0, 'extensionElements', 'values', 1, 'target'],
        ),
      },
      {
        name: 'an input parameter without name',
        moddleElement: engineModel(
          'c7',
          serviceTask(
            'camunda:expression="${true}"',
            '<camunda:inputOutput><camunda:inputParameter>1</camunda:inputParameter></camunda:inputOutput>',
          ),
        ),
        report: report(
          'serviceTask_charge',
          'camunda:inputParameter 1 of serviceTask serviceTask_charge has no name; the engines refuse the file',
          ['extensionElements', 'values', 0, 'inputParameters', 0, 'name'],
        ),
      },
      {
        name: 'a form field without type, and one with a type the engines do not know',
        moddleElement: engineModel(
          'c7',
          userTask(
            '<camunda:formData><camunda:formField id="a" /><camunda:formField id="b" type="String" /><camunda:formField id="c" type="date" /><camunda:formField type="long" /></camunda:formData>',
          ),
        ),
        report: [
          report(
            'userTask_review',
            'Form field a of userTask userTask_review has no type; the engines refuse the file',
            ['extensionElements', 'values', 0, 'fields', 0, 'type'],
          ),
          report(
            'userTask_review',
            'Form field b of userTask userTask_review has type "String", which is not one of the built-in form types string, long, boolean, date, enum; the engines refuse the file (unless a plugin registers it as a custom form type)',
            ['extensionElements', 'values', 0, 'fields', 1, 'type'],
            ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          ),
          report(
            'userTask_review',
            'Form field 4 of userTask userTask_review has no id; the engines refuse the file',
            ['extensionElements', 'values', 0, 'fields', 3, 'id'],
          ),
        ],
      },
      {
        name: 'a connector without connectorId, with a nameless parameter',
        moddleElement: engineModel(
          'c7',
          serviceTask(
            '',
            '<camunda:connector><camunda:inputOutput><camunda:outputParameter>1</camunda:outputParameter></camunda:inputOutput></camunda:connector>',
          ),
        ),
        report: [
          report(
            'serviceTask_charge',
            'camunda:connector of serviceTask serviceTask_charge has no camunda:connectorId; the engines refuse the file',
            ['extensionElements', 'values', 0, 'connectorId'],
          ),
          report(
            'serviceTask_charge',
            'camunda:outputParameter 1 of serviceTask serviceTask_charge has no name; the engines refuse the file',
            ['extensionElements', 'values', 0, 'inputOutput', 'outputParameters', 0, 'name'],
          ),
        ],
      },
      {
        name: 'a class implementation with a field without value',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:class="org.example.X"', '<camunda:field name="a" stringValue="" />'),
        ),
        report: report(
          'serviceTask_charge',
          `camunda:field "a" of serviceTask serviceTask_charge has no value; the engines refuse the file ${FIELD_NEEDS}`,
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'a shell task with a field without value',
        moddleElement: engineModel(
          'c7',
          serviceTask('camunda:type="shell"', '<camunda:field name="command" />'),
        ),
        report: report(
          'serviceTask_charge',
          `camunda:field "command" of serviceTask serviceTask_charge has no value; the engines refuse the file ${FIELD_NEEDS}`,
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'a field with stringValue and a camunda:string element',
        moddleElement: engineModel(
          'c7',
          serviceTask(
            'camunda:class="org.example.X"',
            '<camunda:field name="a" stringValue="x"><camunda:string>y</camunda:string></camunda:field>',
          ),
        ),
        report: report(
          'serviceTask_charge',
          `camunda:field "a" of serviceTask serviceTask_charge has both the attribute stringValue and a camunda:string element; the engines refuse the file ${FIELD_NEEDS}`,
          ['extensionElements', 'values', 0, 'string'],
          ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        ),
      },
      {
        name: 'a delegate expression task listener with a field without value',
        moddleElement: engineModel(
          'c7',
          userTask(
            '<camunda:taskListener event="create" delegateExpression="${l}"><camunda:field name="a" /></camunda:taskListener>',
          ),
        ),
        report: report(
          'userTask_review',
          `camunda:field "a" of camunda:taskListener (event create) of userTask userTask_review has no value; the engines refuse the file ${FIELD_NEEDS}`,
          ['extensionElements', 'values', 0, 'fields', 0],
        ),
      },
      {
        name: 'a message end event with a class and a field without value',
        moddleElement: engineModel(
          'c7',
          `<bpmn:endEvent id="endEvent_notified"><bpmn:messageEventDefinition messageRef="message_paid" camunda:class="a.B">${ext('<camunda:field />')}</bpmn:messageEventDefinition></bpmn:endEvent>`,
          { roots: ROOTS },
        ),
        report: report(
          'endEvent_notified',
          `camunda:field of endEvent:message endEvent_notified has no value; the engines refuse the file ${FIELD_NEEDS}`,
          ['eventDefinitions', 0, 'extensionElements', 'values', 0],
        ),
      },
    ],
  });
});

describe('c7-listener', () => {
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

  verifyEngineRule('c7-listener', rule, {
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
        name: 'a task listener where the engines do not read it (c7-misplaced-extension)',
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
        name: 'an execution listener without implementation',
        moddleElement: engineModel('c7', serviceTask('<camunda:executionListener event="start" />')),
        report: {
          id: 'serviceTask_charge',
          message:
            'camunda:executionListener (event start) of serviceTask serviceTask_charge has no class, expression, delegateExpression or script; the engines refuse the file',
          path: ['extensionElements', 'values', 0],
          type: REQUIRED,
        },
      },
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
      {
        name: 'a script listener without scriptFormat',
        moddleElement: engineModel(
          'c7',
          userTask(
            '<camunda:executionListener event="start"><camunda:script>x</camunda:script></camunda:executionListener>',
          ),
        ),
        report: {
          id: 'userTask_review',
          message:
            'The script of camunda:executionListener (event start) of userTask userTask_review has no scriptFormat; the engines refuse the file',
          path: ['extensionElements', 'values', 0, 'script', 'scriptFormat'],
          type: REQUIRED,
        },
      },
      {
        name: 'a timeout task listener without timer',
        moddleElement: engineModel('c7', timeout('id="taskListener_remind"', '')),
        report: {
          id: 'userTask_review',
          message:
            'camunda:taskListener (event timeout) of userTask userTask_review has no bpmn:timerEventDefinition; the engines refuse the file',
          path: ['extensionElements', 'values', 0, 'eventDefinitions'],
          type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
        },
      },
      {
        name: 'a timeout task listener without id',
        moddleElement: engineModel('c7', timeout('')),
        report: {
          id: 'userTask_review',
          message:
            'camunda:taskListener (event timeout) of userTask userTask_review has no id, which the engines require on timeout task listeners; they refuse the file',
          path: ['extensionElements', 'values', 0, 'id'],
          type: REQUIRED,
        },
      },
      {
        name: 'an execution listener on the process without implementation',
        moddleElement: engineModel(
          'c7',
          `${ext('<camunda:executionListener event="end" />')}<bpmn:userTask id="userTask_review" />`,
        ),
        report: {
          id: 'process_test',
          message:
            'camunda:executionListener (event end) of process process_test has no class, expression, delegateExpression or script; the engines refuse the file',
          path: ['extensionElements', 'values', 0],
          type: REQUIRED,
        },
      },
    ],
  });
});

describe('c7-input-output', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const MAPPING = ext(
    '<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>',
  );
  const OUTPUT_MAPPING = ext(
    '<camunda:inputOutput><camunda:outputParameter name="o">1</camunda:outputParameter></camunda:inputOutput>',
  );
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const MULTI_INSTANCE =
    '<bpmn:multiInstanceLoopCharacteristics camunda:collection="${items}" camunda:elementVariable="item" />';
  const NOT_ALLOWED = ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED;

  verifyEngineRule('c7-input-output', rule, {
    valid: [
      {
        name: 'mappings on tasks and input mappings on an end event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${OUTPUT_MAPPING}</bpmn:userTask><bpmn:userTask id="userTask_check">${MAPPING}${MULTI_INSTANCE}</bpmn:userTask><bpmn:endEvent id="endEvent_done">${MAPPING}</bpmn:endEvent>`,
        ),
      },
      {
        name: 'a mapping on a start event in a non-executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_go">${MAPPING}</bpmn:startEvent>`,
          {
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a mapping on a gateway inside an ad-hoc sub-process of an executable process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:adHocSubProcess id="adHocSubProcess_steps"><bpmn:parallelGateway id="parallelGateway_split">${MAPPING}</bpmn:parallelGateway></bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', '<bpmn:startEvent id="startEvent_go" />'),
      },
    ],
    invalid: [
      {
        name: 'a mapping on a start event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_go">${MAPPING}</bpmn:startEvent>`,
        ),
        report: {
          id: 'startEvent_go',
          message:
            'camunda:inputOutput on startEvent startEvent_go: the engines do not support input/output mappings on a startEvent and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on a boundary event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review" /><bpmn:boundaryEvent id="boundaryEvent_late" attachedToRef="userTask_review">${MAPPING}${TIMER}</bpmn:boundaryEvent>`,
        ),
        report: {
          id: 'boundaryEvent_late',
          message:
            'camunda:inputOutput on boundaryEvent:timer boundaryEvent_late: the engines do not support input/output mappings on a boundaryEvent:timer and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on a gateway',
        moddleElement: engineModel(
          'c7',
          `<bpmn:parallelGateway id="parallelGateway_split">${MAPPING}</bpmn:parallelGateway>`,
        ),
        report: {
          id: 'parallelGateway_split',
          message:
            'camunda:inputOutput on parallelGateway parallelGateway_split: the engines do not support input/output mappings on a parallelGateway and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'a mapping on an event sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:subProcess id="subProcess_cancel" triggeredByEvent="true">${MAPPING}<bpmn:startEvent id="startEvent_cancel">${TIMER}</bpmn:startEvent></bpmn:subProcess>`,
        ),
        report: {
          id: 'subProcess_cancel',
          message:
            'camunda:inputOutput on eventSubProcess subProcess_cancel: the engines do not support input/output mappings on an event sub-process and refuse the file',
          path: ['extensionElements', 'values', 0],
          type: NOT_ALLOWED,
        },
      },
      {
        name: 'an output parameter on an end event',
        moddleElement: engineModel(
          'c7',
          `<bpmn:endEvent id="endEvent_done">${OUTPUT_MAPPING}</bpmn:endEvent>`,
        ),
        report: {
          id: 'endEvent_done',
          message:
            'camunda:outputParameter on end event endEvent_done: the engines refuse output mappings on end events',
          path: ['extensionElements', 'values', 0, 'outputParameters'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'an output parameter on a multi-instance task',
        moddleElement: engineModel(
          'c7',
          `<bpmn:userTask id="userTask_review">${OUTPUT_MAPPING}${MULTI_INSTANCE}</bpmn:userTask>`,
        ),
        report: {
          id: 'userTask_review',
          message:
            'camunda:outputParameter on multi-instance userTask userTask_review: the engines refuse output mappings on multi-instance activities',
          path: ['extensionElements', 'values', 0, 'outputParameters'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

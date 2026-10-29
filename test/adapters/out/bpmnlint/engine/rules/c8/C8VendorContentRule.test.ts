import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';

import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8VendorContentRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c8-foreign-content', () => {
  const CAMUNDA = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const USER_TASK = (attributes: string, inner = '') =>
    `<bpmn:userTask id="userTask_review" ${attributes}>${ext(`<zeebe:userTask />${inner}`)}</bpmn:userTask>`;
  const INPUT_OUTPUT = (prefix: string) =>
    `<${prefix}:inputOutput><${prefix}:inputParameter name="a">1</${prefix}:inputParameter></${prefix}:inputOutput>`;

  verifyEngineRule('c8-foreign-content', rule, {
    valid: [
      {
        name: 'zeebe content only',
        moddleElement: engineModel(
          'c8',
          USER_TASK('', '<zeebe:assignmentDefinition assignee="demo" />'),
          { definitionsAttributes: CAMUNDA },
        ),
      },
      {
        name: 'Camunda 7 content in a non-executable process',
        moddleElement: engineModel(
          'c8',
          USER_TASK('camunda:assignee="demo"', INPUT_OUTPUT('camunda')),
          {
            definitionsAttributes: CAMUNDA,
            processAttributes: 'isExecutable="false"',
          },
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          '<bpmn:userTask id="userTask_review" camunda:assignee="demo" />',
        ),
      },
    ],
    invalid: [
      {
        name: 'a Camunda 7 attribute and extension element',
        moddleElement: engineModel(
          'c8',
          USER_TASK('camunda:assignee="demo"', INPUT_OUTPUT('camunda')),
          {
            definitionsAttributes: CAMUNDA,
          },
        ),
        report: [
          {
            id: 'userTask_review',
            message:
              'userTask userTask_review carries the Camunda 7 attribute camunda:assignee, which Camunda 8 ignores',
            path: ['camunda:assignee'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'userTask_review',
            message:
              'userTask userTask_review contains the Camunda 7 extension camunda:inputOutput, which Camunda 8 ignores',
            path: ['extensionElements', 'values', 1],
            type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'Operaton content under another prefix',
        moddleElement: engineModel(
          'c8',
          `<bpmn:serviceTask id="serviceTask_charge" op:asyncBefore="true">${ext(
            `<zeebe:taskDefinition type="charge" />${INPUT_OUTPUT('op')}`,
          )}</bpmn:serviceTask>`,
          { definitionsAttributes: 'xmlns:op="http://operaton.org/schema/1.0/bpmn"' },
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'serviceTask serviceTask_charge carries the Camunda 7 attribute op:asyncBefore, which Camunda 8 ignores',
            path: ['op:asyncBefore'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'serviceTask serviceTask_charge contains the Camunda 7 extension op:inputOutput, which Camunda 8 ignores',
            path: ['extensionElements', 'values', 1],
            type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'a Camunda 7 attribute on an event definition',
        moddleElement: engineModel(
          'c8',
          `<bpmn:endEvent id="endEvent_notified">
            <bpmn:messageEventDefinition id="messageEventDefinition_notified" camunda:topic="notify" />
          </bpmn:endEvent>`,
          { definitionsAttributes: CAMUNDA },
        ),
        report: {
          id: 'endEvent_notified',
          message:
            'messageEventDefinition messageEventDefinition_notified carries the Camunda 7 attribute camunda:topic, which Camunda 8 ignores',
          path: ['eventDefinitions', 0, 'camunda:topic'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
    ],
  });
});

describe('c8-unknown-attribute', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const SERVICE_TASK = (attributes: string, inner = '<zeebe:taskDefinition type="charge" />') =>
    `<bpmn:serviceTask id="serviceTask_charge" ${attributes}>${ext(inner)}</bpmn:serviceTask>`;

  verifyEngineRule('c8-unknown-attribute', rule, {
    valid: [
      {
        name: 'known zeebe attributes on BPMN and zeebe elements',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            'zeebe:modelerTemplate="io.example.charge" zeebe:retryCounter="3"',
            '<zeebe:taskDefinition type="charge" retries="3" /><zeebe:ioMapping><zeebe:input source="=a" target="a" /></zeebe:ioMapping>',
          ),
        ),
      },
      {
        name: 'a zeebe attribute on the wrong BPMN element (c8-misplaced-attribute reports it)',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_review" zeebe:retryCounter="3"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>',
        ),
      },
      {
        name: 'an unknown attribute of a zeebe element on a host that does not read it',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_review"><bpmn:extensionElements><zeebe:userTask /><zeebe:taskDefinition type="w" typo="x" /></bpmn:extensionElements></bpmn:userTask>',
        ),
      },
      {
        name: 'unknown zeebe attributes in a non-executable process',
        moddleElement: engineModel('c8', SERVICE_TASK('zeebe:foo="x"'), {
          processAttributes: 'isExecutable="false"',
        }),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel('c7', '<bpmn:userTask id="userTask_review" camunda:typo="x" />'),
      },
    ],
    invalid: [
      {
        name: 'an unknown zeebe attribute on a BPMN element and on a zeebe element',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            'zeebe:foo="x"',
            '<zeebe:taskDefinition type="w" typo="x" /><zeebe:taskDefinitions />',
          ),
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'serviceTask serviceTask_charge has the unknown attribute zeebe:foo; Camunda 8 ignores it (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)',
            path: ['zeebe:foo'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'zeebe:taskDefinition of serviceTask serviceTask_charge has the unknown attribute typo (did you mean type?); Camunda 8 ignores it',
            path: ['extensionElements', 'values', 0, 'typo'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
        ],
      },
      {
        name: 'an attribute of a zeebe extension element on the user task itself',
        moddleElement: engineModel(
          'c8',
          '<bpmn:userTask id="userTask_review" zeebe:assignee="demo"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>',
        ),
        report: {
          id: 'userTask_review',
          message:
            'userTask userTask_review has the unknown attribute zeebe:assignee; Camunda 8 ignores it (it reads assignee on the zeebe:assignmentDefinition extension element)',
          path: ['zeebe:assignee'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'a typo of a zeebe attribute, under another prefix',
        moddleElement: engineModel(
          'c8',
          '<bpmn:serviceTask id="serviceTask_charge" z:modelerTemplat="x"><bpmn:extensionElements><z:taskDefinition type="charge" /></bpmn:extensionElements></bpmn:serviceTask>',
          { definitionsAttributes: 'xmlns:z="http://camunda.org/schema/zeebe/1.0"' },
        ),
        report: {
          id: 'serviceTask_charge',
          message:
            'serviceTask serviceTask_charge has the unknown attribute zeebe:modelerTemplat (did you mean zeebe:modelerTemplate?); Camunda 8 ignores it (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)',
          path: ['zeebe:modelerTemplat'],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        },
      },
      {
        name: 'unknown attributes of nested zeebe elements',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            '',
            `<zeebe:taskDefinition type="charge" />
            <zeebe:ioMapping><zeebe:input source="=a" target="a" sorce="b" /></zeebe:ioMapping>
            <zeebe:executionListeners><zeebe:executionListener eventType="end" type="audit"><zeebe:taskHeaders><zeebe:header key="k" value="v" kind="x" /></zeebe:taskHeaders></zeebe:executionListener></zeebe:executionListeners>`,
          ),
        ),
        report: [
          {
            id: 'serviceTask_charge',
            message:
              'zeebe:input (in zeebe:ioMapping) of serviceTask serviceTask_charge has the unknown attribute sorce (did you mean source?); Camunda 8 ignores it',
            path: ['extensionElements', 'values', 1, 'inputParameters', 0, 'sorce'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
          {
            id: 'serviceTask_charge',
            message:
              'zeebe:header (in zeebe:executionListeners > zeebe:executionListener > zeebe:taskHeaders) of serviceTask serviceTask_charge has the unknown attribute kind; Camunda 8 ignores it',
            path: ['extensionElements', 'values', 2, 'listeners', 0, 'headers', 'values', 0, 'kind'],
            type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          },
        ],
      },
    ],
  });
});

describe('c8-misplaced-attribute', () => {
  const LANES = (attributes: string) =>
    `<bpmn:laneSet id="laneSet_order"><bpmn:lane id="lane_sales" ${attributes} /></bpmn:laneSet>`;

  verifyEngineRule('c8-misplaced-attribute', rule, {
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
        name: 'an unknown zeebe attribute (c8-unknown-attribute reports it)',
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

describe('c8-misplaced-extension', () => {
  const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
  const TASK_DEFINITION = '<zeebe:taskDefinition type="charge" />';
  const SERVICE_TASK = (inner: string, loop = '') =>
    `<bpmn:serviceTask id="serviceTask_charge">${ext(inner)}${loop}</bpmn:serviceTask>`;
  const IO_MAPPING = (mappings: string) => `<zeebe:ioMapping>${mappings}</zeebe:ioMapping>`;
  const TIMER =
    '<bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
  const NOT_READ = (id: string, message: string, path: (string | number)[]) => ({
    id,
    message,
    path,
    type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
  });

  verifyEngineRule('c8-misplaced-extension', rule, {
    valid: [
      {
        name: 'zeebe content where Camunda 8 reads it',
        moddleElement: engineModel(
          'c8',
          `${SERVICE_TASK(
            TASK_DEFINITION + IO_MAPPING('<zeebe:input source="=a" target="a" />'),
            `<bpmn:multiInstanceLoopCharacteristics>${ext('<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" />')}</bpmn:multiInstanceLoopCharacteristics>`,
          )}
          <bpmn:userTask id="userTask_review">${ext('<zeebe:userTask /><zeebe:assignmentDefinition assignee="demo" /><zeebe:properties><zeebe:property name="a" value="1" /></zeebe:properties>')}</bpmn:userTask>
          <bpmn:receiveTask id="receiveTask_paid" messageRef="message_paid" />`,
          {
            roots: `<bpmn:message id="message_paid" name="paid">${ext('<zeebe:subscription correlationKey="=orderId" />')}</bpmn:message>`,
          },
        ),
      },
      {
        name: 'output mappings on a start event, input mappings on a message throw event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:output source="=1" target="b" />'))}</bpmn:startEvent>
          <bpmn:intermediateThrowEvent id="event_notified">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" />'))}
            <bpmn:messageEventDefinition id="messageEventDefinition_notified" />
          </bpmn:intermediateThrowEvent>`,
        ),
      },
      {
        name: 'execution listeners on a sequence flow (c8-listener reports them)',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received" />
          <bpmn:sequenceFlow id="flow_received" sourceRef="startEvent_received" targetRef="endEvent_done">
            ${ext('<zeebe:executionListeners><zeebe:executionListener eventType="start" type="audit" /></zeebe:executionListeners>')}
          </bpmn:sequenceFlow>
          <bpmn:endEvent id="endEvent_done" />`,
        ),
      },
      {
        name: 'misplaced zeebe content in a non-executable process',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" />'))}</bpmn:startEvent>`,
          { processAttributes: 'isExecutable="false"' },
        ),
      },
      {
        name: 'a Camunda 7 diagram',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="startEvent_received">${ext('<camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput>')}</bpmn:startEvent>`,
        ),
      },
    ],
    invalid: [
      {
        name: 'zeebe content on hosts that do not read it',
        moddleElement: engineModel(
          'c8',
          `<bpmn:userTask id="userTask_review">${ext(`<zeebe:userTask />${TASK_DEFINITION}`)}</bpmn:userTask>
          ${SERVICE_TASK(`${TASK_DEFINITION}<zeebe:userTask /><zeebe:calledDecision decisionId="d" resultVariable="r" />`)}`,
        ),
        report: [
          NOT_READ(
            'userTask_review',
            'zeebe:taskDefinition on userTask userTask_review has no effect: Camunda 8 reads it on serviceTask, businessRuleTask, scriptTask, sendTask, endEvent, ... only',
            ['extensionElements', 'values', 1],
          ),
          NOT_READ(
            'serviceTask_charge',
            'zeebe:userTask on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on userTask only',
            ['extensionElements', 'values', 1],
          ),
          NOT_READ(
            'serviceTask_charge',
            'zeebe:calledDecision on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on businessRuleTask only',
            ['extensionElements', 'values', 2],
          ),
        ],
      },
      {
        name: 'zeebe:loopCharacteristics on the activity instead of its loop',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(
            `${TASK_DEFINITION}<zeebe:loopCharacteristics inputCollection="=items" inputElement="item" />`,
            '<bpmn:multiInstanceLoopCharacteristics />',
          ),
        ),
        report: NOT_READ(
          'serviceTask_charge',
          'zeebe:loopCharacteristics on serviceTask serviceTask_charge has no effect: Camunda 8 reads it on multiInstanceLoopCharacteristics only',
          ['extensionElements', 'values', 1],
        ),
      },
      {
        name: 'io mapping on a gateway',
        moddleElement: engineModel(
          'c8',
          `<bpmn:exclusiveGateway id="gateway_approved">${ext(IO_MAPPING('<zeebe:output source="=1" target="a" />'))}</bpmn:exclusiveGateway>`,
        ),
        report: NOT_READ(
          'gateway_approved',
          'zeebe:ioMapping on exclusiveGateway gateway_approved has no effect: Camunda 8 reads it on callActivity, event, receiveTask, serviceTask, businessRuleTask, ... only',
          ['extensionElements', 'values', 0],
        ),
      },
      {
        name: 'a loose zeebe:header outside zeebe:taskHeaders',
        moddleElement: engineModel(
          'c8',
          SERVICE_TASK(`${TASK_DEFINITION}<zeebe:header key="k" value="v" />`),
        ),
        report: NOT_READ(
          'serviceTask_charge',
          'zeebe:header sits directly in the extension elements of serviceTask serviceTask_charge, but belongs inside zeebe:taskHeaders; Camunda 8 ignores it',
          ['extensionElements', 'values', 1],
        ),
      },
      {
        name: 'input mappings on a start, a boundary, a none throw and a none end event',
        moddleElement: engineModel(
          'c8',
          `<bpmn:startEvent id="startEvent_received">${ext(IO_MAPPING('<zeebe:input source="=1" target="a" /><zeebe:output source="=2" target="b" />'))}</bpmn:startEvent>
          ${SERVICE_TASK(TASK_DEFINITION)}
          <bpmn:boundaryEvent id="boundaryEvent_timeout" attachedToRef="serviceTask_charge">${ext(IO_MAPPING('<zeebe:input source="=1" target="c" />'))}${TIMER}</bpmn:boundaryEvent>
          <bpmn:intermediateThrowEvent id="event_charged">${ext(IO_MAPPING('<zeebe:input source="=1" target="d" />'))}</bpmn:intermediateThrowEvent>
          <bpmn:endEvent id="endEvent_done">${ext(IO_MAPPING('<zeebe:input source="=1" />'))}</bpmn:endEvent>`,
        ),
        report: [
          NOT_READ(
            'startEvent_received',
            'The input mapping to a on startEvent startEvent_received has no effect: Camunda 8 ignores input mappings on start events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'boundaryEvent_timeout',
            'The input mapping to c on boundaryEvent:timer boundaryEvent_timeout has no effect: Camunda 8 ignores input mappings on boundary events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'event_charged',
            'The input mapping to d on intermediateThrowEvent event_charged has no effect: Camunda 8 ignores input mappings on none intermediate throw events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
          NOT_READ(
            'endEvent_done',
            'The input mapping on endEvent endEvent_done has no effect: Camunda 8 ignores input mappings on none end events (output mappings work there)',
            ['extensionElements', 'values', 0, 'inputParameters', 0],
          ),
        ],
      },
    ],
  });
});

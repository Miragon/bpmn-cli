import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8MultiInstanceNeedsFeelRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

const BAD = '= (a';
const REFUSED = 'Camunda 8 parses it at deploy and refuses the file';
const ext = (inner: string) => `<bpmn:extensionElements>${inner}</bpmn:extensionElements>`;
const JOB = '<zeebe:taskDefinition type="work" />';
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const chain = (middle: string) => `
  <bpmn:startEvent id="startEvent_start" />
  <bpmn:sequenceFlow id="flow_toX" sourceRef="startEvent_start" targetRef="X" />
  ${middle}
  <bpmn:sequenceFlow id="flow_fromX" sourceRef="X" targetRef="endEvent_end" />
  <bpmn:endEvent id="endEvent_end" />`;
const gateway = (condition: string) => `
  <bpmn:startEvent id="startEvent_start" />
  <bpmn:sequenceFlow id="flow_toGateway" sourceRef="startEvent_start" targetRef="G" />
  <bpmn:exclusiveGateway id="G" default="SD" />
  <bpmn:sequenceFlow id="SD" sourceRef="G" targetRef="endEvent_default" />
  <bpmn:endEvent id="endEvent_default" />
  <bpmn:sequenceFlow id="S0" sourceRef="G" targetRef="endEvent_s0">
    <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escape(condition)}</bpmn:conditionExpression>
  </bpmn:sequenceFlow>
  <bpmn:endEvent id="endEvent_s0" />`;
const adHoc = (inner: string, zeebe = '') =>
  chain(
    `<bpmn:adHocSubProcess id="X">${zeebe ? ext(zeebe) : ''}<bpmn:task id="A1" />${inner}</bpmn:adHocSubProcess>`,
  );
const completion = (body: string) =>
  `<bpmn:completionCondition xsi:type="bpmn:tFormalExpression">${escape(body)}</bpmn:completionCondition>`;
const multiInstance = (zeebeLoop: string, inner = '') =>
  chain(
    `<bpmn:serviceTask id="X">${ext(JOB)}<bpmn:multiInstanceLoopCharacteristics>${ext(zeebeLoop)}${inner}</bpmn:multiInstanceLoopCharacteristics></bpmn:serviceTask>`,
  );
const timer = (kind: string, value: string) =>
  `<bpmn:timerEventDefinition id="TD1"><bpmn:${kind} xsi:type="bpmn:tFormalExpression">${escape(value)}</bpmn:${kind}></bpmn:timerEventDefinition>`;
const conditional = (condition: string) =>
  `<bpmn:conditionalEventDefinition id="CD1"><bpmn:condition xsi:type="bpmn:tFormalExpression">${escape(condition)}</bpmn:condition></bpmn:conditionalEventDefinition>`;
const message = (name: string, key: string | null = '=orderId') =>
  `<bpmn:message id="M1" name="${escape(name)}">${key === null ? '' : ext(`<zeebe:subscription correlationKey="${escape(key)}" />`)}</bpmn:message>`;
const feel = (
  id: string,
  what: string,
  value: string,
  problem: string,
  path: (string | number)[],
) => ({
  id,
  message: `${what} "${value}" is no valid FEEL: ${problem}; ${REFUSED}`,
  path,
  type: ERROR_TYPES.FEEL_EXPRESSION_INVALID,
});
const notFeel = (id: string, message: string, path: (string | number)[]) => ({
  id,
  message,
  path,
  type: ERROR_TYPES.EXPRESSION_REQUIRED,
});

verifyEngineRule(rule, {
  valid: [
    ...[
      '= x andy',
      '= x in [1..5]',
      '= x in (> 1, < 5)',
      '= {a: 1}.a = 1',
      '= string length(x) > 2',
    ].map((condition) => ({
      name: `a condition FEEL accepts: ${condition}`,
      moddleElement: engineModel('c8', gateway(condition)),
    })),
    {
      name: 'a FEEL completion condition of an ad-hoc sub-process',
      moddleElement: engineModel('c8', adHoc(completion('= a and b'))),
    },
    {
      name: 'attributes Camunda 8 does not parse at deploy (listener type, header value)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:serviceTask id="X">${ext(`${JOB}<zeebe:taskHeaders><zeebe:header key="k" value="${BAD}" /></zeebe:taskHeaders><zeebe:executionListeners><zeebe:executionListener eventType="end" type="${BAD}" /></zeebe:executionListeners>`)}</bpmn:serviceTask>`,
        ),
      ),
    },
    {
      name: 'a FEEL timer value',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:intermediateCatchEvent id="X">${timer('timeDuration', '=wait')}</bpmn:intermediateCatchEvent>`,
        ),
      ),
    },
    {
      name: 'FEEL values in the multi-instance and the script',
      moddleElement: engineModel(
        'c8',
        multiInstance(
          '<zeebe:loopCharacteristics inputCollection="=items" outputCollection="out" outputElement="=result" />',
          completion('= done'),
        ) +
          `<bpmn:scriptTask id="Y">${ext('<zeebe:script expression="=1 + 1" resultVariable="r" />')}</bpmn:scriptTask>`,
      ),
    },
    {
      name: 'a multi-instance completion condition that is no FEEL (a runtime matter, c8-multi-instance-completion-needs-feel)',
      moddleElement: engineModel(
        'c8',
        multiInstance(
          '<zeebe:loopCharacteristics inputCollection="=items" />',
          completion('${done}'),
        ),
      ),
    },
    {
      name: 'a JUEL condition in a process that is not executable',
      moddleElement: engineModel('c8', gateway('${x > 1}'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a JUEL condition inside a transaction (refused as a whole)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:transaction id="X">${gateway('${x > 1}')}</bpmn:transaction>`,
      ),
    },
    {
      name: 'a zeebe:script on a service task (not read there)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:serviceTask id="X">${ext(`${JOB}<zeebe:script expression="${BAD}" resultVariable="r" />`)}</bpmn:serviceTask>`,
        ),
      ),
    },
    {
      name: 'a zeebe:input outside its zeebe:ioMapping (not read)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:serviceTask id="X">${ext(`${JOB}<zeebe:input source="${BAD}" target="a" />`)}</bpmn:serviceTask>`,
        ),
      ),
    },
    {
      name: 'a script with a job (the job runs, the script is not read)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:scriptTask id="X">${ext(`${JOB}<zeebe:script expression="1 + 1" resultVariable="r" />`)}</bpmn:scriptTask>`,
        ),
      ),
    },
    {
      name: 'a message no element uses, with a FEEL slip in its name and key',
      moddleElement: engineModel('c8', chain('<bpmn:task id="X" />'), { roots: message(BAD, BAD) }),
    },
    {
      name: 'a timer cycle on an intermediate catch event (refused for the cycle)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:intermediateCatchEvent id="X">${timer('timeCycle', BAD)}</bpmn:intermediateCatchEvent>`,
        ),
      ),
    },
    {
      name: 'a static correlation key on the message of a process start event (not read there)',
      moddleElement: engineModel(
        'c8',
        `<bpmn:startEvent id="S"><bpmn:messageEventDefinition id="MD" messageRef="M1" /></bpmn:startEvent>
         <bpmn:sequenceFlow id="F" sourceRef="S" targetRef="E" /><bpmn:endEvent id="E" />`,
        { roots: message('Paid', 'orderId') },
      ),
    },
    {
      name: 'an event with two definitions (refused for that)',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:intermediateCatchEvent id="X">${conditional('true')}${timer('timeDuration', 'PT1H')}</bpmn:intermediateCatchEvent>`,
        ),
      ),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', gateway('${x > 1}')),
    },
  ],
  invalid: [
    {
      name: 'a multi-instance with a static inputCollection',
      moddleElement: engineModel(
        'c8',
        multiInstance('<zeebe:loopCharacteristics inputCollection="items" inputElement="item" />'),
      ),
      report: notFeel(
        'X',
        'inputCollection="items" of multi-instance serviceTask X is a static value; Camunda 8 needs a FEEL expression (=items) and refuses the file',
        ['loopCharacteristics', 'extensionElements', 'values', 0, 'inputCollection'],
      ),
    },
    {
      name: 'a multi-instance with a static outputElement',
      moddleElement: engineModel(
        'c8',
        multiInstance(
          '<zeebe:loopCharacteristics inputCollection="=items" outputCollection="out" outputElement="result" />',
        ),
      ),
      report: notFeel(
        'X',
        'outputElement="result" of multi-instance serviceTask X is a static value; Camunda 8 needs a FEEL expression (=result) and refuses the file',
        ['loopCharacteristics', 'extensionElements', 'values', 0, 'outputElement'],
      ),
    },
  ],
});

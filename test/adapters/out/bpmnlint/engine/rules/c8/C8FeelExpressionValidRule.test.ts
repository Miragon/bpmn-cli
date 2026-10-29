import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/C8FeelExpressionValidRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

const BAD = '= (a';
const BAD_PROBLEM = 'an unclosed (';
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
const signal = (name: string) => `<bpmn:signal id="Sig" name="${escape(name)}" />`;
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
const REFUSED_CONDITIONS: Array<[string, string]> = [
  ['= x & y', '& (FEEL: and)'],
  ['= x | y', '| (FEEL: or)'],
  ['= x <> 1', '<> (FEEL: != for "not equal")'],
  ['= x >> 1', '>> (FEEL has no shift operators)'],
  ['= x % 2 = 0', '% (FEEL has no modulo operator: modulo(a, b))'],
  ['= if x then true', 'if ... then without else: FEEL needs if c then a else b'],
  ['= x AND y', 'AND (FEEL keywords are lower case: and)'],
  ['= x := 1', ':= (FEEL has no assignment; = compares)'],
  ['= x == 1 && y', '&& (FEEL: and)'],
];

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
    ...REFUSED_CONDITIONS.map(([condition, problem]) => ({
      name: `a condition FEEL refuses: ${condition}`,
      moddleElement: engineModel('c8', gateway(condition)),
      report: feel('S0', 'The condition of sequence flow S0', condition, problem, [
        'conditionExpression',
      ]),
    })),
    {
      name: 'a FEEL slip in a zeebe:script',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:scriptTask id="X">${ext('<zeebe:script expression="= if a then 1" resultVariable="r" />')}</bpmn:scriptTask>`,
        ),
      ),
      report: feel(
        'X',
        'expression of zeebe:script of scriptTask X',
        '= if a then 1',
        'if ... then without else: FEEL needs if c then a else b',
        ['extensionElements', 'values', 0, 'expression'],
      ),
    },
    {
      name: 'a FEEL slip in an ad-hoc completion condition',
      moddleElement: engineModel('c8', adHoc(completion(BAD))),
      report: feel('X', 'The completion condition of ad-hoc sub-process X', BAD, BAD_PROBLEM, [
        'completionCondition',
      ]),
    },
    ...['activeElementsCollection', 'outputElement'].map((attribute) => ({
      name: `a FEEL slip in the ${attribute} of zeebe:adHoc`,
      moddleElement: engineModel(
        'c8',
        adHoc('', `<zeebe:adHoc outputCollection="res" ${attribute}="${BAD}" />`),
      ),
      report: feel('X', `${attribute} of zeebe:adHoc of adHocSubProcess X`, BAD, BAD_PROBLEM, [
        'extensionElements',
        'values',
        0,
        attribute,
      ]),
    })),
    ...['intermediateThrowEvent', 'intermediateCatchEvent'].map((kind) => ({
      name: `a FEEL slip in the name of a signal (${kind})`,
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:${kind} id="X"><bpmn:signalEventDefinition id="SD" signalRef="Sig" /></bpmn:${kind}>`,
        ),
        { roots: signal(BAD) },
      ),
      report: feel('Sig', 'The name of signal Sig', BAD, BAD_PROBLEM, ['name']),
    })),
    {
      name: 'a FEEL slip in the name of a published message, in a process that is not executable',
      moddleElement: engineModel(
        'c8',
        chain(`<bpmn:sendTask id="X" messageRef="M1">${ext(JOB)}</bpmn:sendTask>`),
        {
          roots: message(BAD, null),
          processAttributes: 'isExecutable="false"',
        },
      ),
      report: feel('M1', 'The name of message M1', BAD, BAD_PROBLEM, ['name']),
    },
    {
      name: 'a FEEL slip in the correlation key of a caught message, reported on the message',
      moddleElement: engineModel('c8', chain('<bpmn:receiveTask id="X" messageRef="M1" />'), {
        roots: message('Paid', BAD),
      }),
      report: feel('M1', 'correlationKey of zeebe:subscription of message M1', BAD, BAD_PROBLEM, [
        'extensionElements',
        'values',
        0,
        'correlationKey',
      ]),
    },
    {
      name: 'a FEEL slip in the inputCollection, reported through the loop',
      moddleElement: engineModel(
        'c8',
        multiInstance(`<zeebe:loopCharacteristics inputCollection="${BAD}" />`),
      ),
      report: feel(
        'X',
        'inputCollection of zeebe:loopCharacteristics of the multiInstanceLoopCharacteristics of serviceTask X',
        BAD,
        BAD_PROBLEM,
        ['loopCharacteristics', 'extensionElements', 'values', 0, 'inputCollection'],
      ),
    },
    {
      name: 'a FEEL slip in a multi-instance completion condition',
      moddleElement: engineModel(
        'c8',
        multiInstance('<zeebe:loopCharacteristics inputCollection="=items" />', completion(BAD)),
      ),
      report: feel(
        'X',
        'The completion condition of multi-instance serviceTask X',
        BAD,
        BAD_PROBLEM,
        ['loopCharacteristics', 'completionCondition'],
      ),
    },
    {
      name: 'an input mapping with a JUEL slip',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:serviceTask id="X">${ext(`${JOB}<zeebe:ioMapping><zeebe:input source="= a &amp;&amp; b" target="a" /></zeebe:ioMapping>`)}</bpmn:serviceTask>`,
        ),
      ),
      report: feel(
        'X',
        'source of zeebe:input (in zeebe:ioMapping) of serviceTask X',
        '= a && b',
        '&& (FEEL: and)',
        ['extensionElements', 'values', 1, 'inputParameters', 0, 'source'],
      ),
    },
    {
      name: 'a FEEL slip in the condition of a conditional event',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:intermediateCatchEvent id="X">${conditional(BAD)}</bpmn:intermediateCatchEvent>`,
        ),
      ),
      report: feel('X', 'The condition of conditional event X', BAD, BAD_PROBLEM, [
        'eventDefinitions',
        0,
        'condition',
      ]),
    },
    {
      name: 'a FEEL slip in a timer',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:intermediateCatchEvent id="X">${timer('timeDuration', BAD)}</bpmn:intermediateCatchEvent>`,
        ),
      ),
      report: feel('X', 'The timeDuration of intermediateCatchEvent:timer X', BAD, BAD_PROBLEM, [
        'eventDefinitions',
        0,
        'timeDuration',
      ]),
    },
    {
      name: 'a JUEL value in a zeebe:taskDefinition type',
      moddleElement: engineModel(
        'c8',
        chain(
          `<bpmn:serviceTask id="X">${ext('<zeebe:taskDefinition type="=${kind}" />')}</bpmn:serviceTask>`,
        ),
      ),
      report: feel(
        'X',
        'type of zeebe:taskDefinition of serviceTask X',
        '=${kind}',
        '${...} (JUEL; FEEL writes the expression itself: = amount > 100)',
        ['extensionElements', 'values', 0, 'type'],
      ),
    },
  ],
});

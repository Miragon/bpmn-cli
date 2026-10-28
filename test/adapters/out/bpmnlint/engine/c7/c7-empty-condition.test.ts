import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-empty-condition.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const flow = (id: string, from: string, target: string, condition = '') =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${target}">${condition}</bpmn:sequenceFlow>`;
const EMPTY = '<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" />';
const EXPRESSION =
  '<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${a}</bpmn:conditionExpression>';
const conditional = (condition: string) =>
  `<bpmn:conditionalEventDefinition id="CDef">${condition}</bpmn:conditionalEventDefinition>`;
const TIMER =
  '<bpmn:timerEventDefinition id="TDef"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>';
const EMPTY_CONDITION = '<bpmn:condition xsi:type="bpmn:tFormalExpression" />';
/** Start -> catch event W (with `definitions`) -> End */
const catchWith = (definitions: string) => `
  <bpmn:startEvent id="Start" />
  <bpmn:intermediateCatchEvent id="W">${definitions}</bpmn:intermediateCatchEvent>
  <bpmn:endEvent id="End" />
  ${flow('F1', 'Start', 'W')}${flow('F2', 'W', 'End')}`;
/** a task T with three branches; `default` names its default flow */
const fromTask = (first: string, defaultFlow = 'F3') => `
  <bpmn:startEvent id="Start" /><bpmn:userTask id="T" default="${defaultFlow}" />
  <bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" /><bpmn:endEvent id="E3" />
  ${flow('F0', 'Start', 'T')}${flow('F1', 'T', 'E1', first)}${flow('F2', 'T', 'E2', EXPRESSION)}${flow('F3', 'T', 'E3')}`;
const fromGateway = (gateway: string) => `
  <bpmn:startEvent id="Start" />${gateway}<bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" />
  ${flow('F0', 'Start', 'G')}${flow('F1', 'G', 'E1', EMPTY)}${flow('F2', 'G', 'E2')}`;

const flowReport = (id: string) => ({
  id,
  message: `Sequence flow ${id} has an empty condition (no expression and no camunda:resource): it deploys, but the engines fail when they evaluate it`,
  path: ['conditionExpression'],
  type: ERROR_TYPES.EXPRESSION_REQUIRED,
});
const eventReport = (id: string, index = 0) => ({
  id,
  message: `Conditional event ${id} has an empty condition (no expression and no camunda:resource): it deploys, but evaluating it fails when the process runs`,
  path: ['eventDefinitions', index, 'condition'],
  type: ERROR_TYPES.EXPRESSION_REQUIRED,
});

verifyEngineRule('c7-empty-condition', rule, {
  valid: [
    {
      name: 'a conditional event with a camunda:resource script condition',
      moddleElement: engineModel(
        'c7',
        catchWith(
          conditional(
            '<bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://c.groovy" />',
          ),
        ),
      ),
    },
    {
      name: 'a conditional event with an expression',
      moddleElement: engineModel(
        'c7',
        catchWith(
          conditional(
            '<bpmn:condition xsi:type="bpmn:tFormalExpression">${ready}</bpmn:condition>',
          ),
        ),
      ),
    },
    {
      name: 'a conditional event without a condition element (the schema rule reports it)',
      moddleElement: engineModel('c7', catchWith(conditional(''))),
    },
    {
      name: 'an empty condition on an ignored conditional definition (the timer acts)',
      moddleElement: engineModel('c7', catchWith(TIMER + conditional(EMPTY_CONDITION))),
    },
    {
      name: 'a sequence flow with a camunda:resource script condition',
      moddleElement: engineModel(
        'c7',
        fromTask(
          '<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="groovy" camunda:resource="deployment://c.groovy" />',
        ),
      ),
    },
    {
      name: 'an empty condition on the default flow',
      moddleElement: engineModel('c7', fromTask(EMPTY, 'F1')),
    },
    {
      name: 'an empty condition out of a parallel gateway',
      moddleElement: engineModel('c7', fromGateway('<bpmn:parallelGateway id="G" />')),
    },
    {
      name: 'an empty condition out of an event-based gateway',
      moddleElement: engineModel('c7', fromGateway('<bpmn:eventBasedGateway id="G" />')),
    },
    {
      name: 'an empty condition in a non-executable process',
      moddleElement: engineModel('c7', fromTask(EMPTY), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'an empty condition in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${fromTask(EMPTY)}${catchWith(conditional(EMPTY_CONDITION)).replace(/"(Start|End|F1|F2)"/g, '"$1b"')}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', fromTask(EMPTY)),
    },
  ],
  invalid: [
    {
      name: 'a conditional event with an empty condition',
      moddleElement: engineModel('c7', catchWith(conditional(EMPTY_CONDITION))),
      report: eventReport('W'),
    },
    {
      name: 'a conditional start event with an empty groovy condition',
      moddleElement: engineModel(
        'c7',
        `<bpmn:startEvent id="Start">${conditional('<bpmn:condition xsi:type="bpmn:tFormalExpression" language="groovy" />')}</bpmn:startEvent>
        <bpmn:userTask id="T" /><bpmn:endEvent id="End" />${flow('F1', 'Start', 'T')}${flow('F2', 'T', 'End')}`,
      ),
      report: eventReport('Start'),
    },
    {
      name: 'a blank condition next to an escalation definition (no known order: both are read)',
      moddleElement: engineModel(
        'c7',
        catchWith(
          `<bpmn:escalationEventDefinition id="EDef" />${conditional('<bpmn:condition xsi:type="bpmn:tFormalExpression">  </bpmn:condition>')}`,
        ),
      ),
      report: eventReport('W', 1),
    },
    {
      name: 'a sequence flow with an empty condition (not on a default flow)',
      moddleElement: engineModel('c7', fromTask(EMPTY)),
      report: flowReport('F1'),
    },
    {
      name: 'a sequence flow with an untyped empty condition out of an exclusive gateway',
      moddleElement: engineModel(
        'c7',
        fromGateway('<bpmn:exclusiveGateway id="G" default="F2" />').replace(
          EMPTY,
          '<bpmn:conditionExpression />',
        ),
      ),
      report: flowReport('F1'),
    },
  ],
});

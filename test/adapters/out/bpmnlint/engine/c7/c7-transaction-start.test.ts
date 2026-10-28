import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-transaction-start.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const MESSAGES = '<bpmn:message id="M1" name="Verify1" />';
const START = '<bpmn:startEvent id="Start" />';
const transaction = (inner: string) =>
  `${START}<bpmn:transaction id="SP">${inner}</bpmn:transaction>`;
const WITH_START =
  '<bpmn:startEvent id="SS" /><bpmn:userTask id="T" /><bpmn:endEvent id="SE" /><bpmn:sequenceFlow id="s1" sourceRef="SS" targetRef="T" /><bpmn:sequenceFlow id="s2" sourceRef="T" targetRef="SE" />';

const report = (what: string) => ({
  id: 'SP',
  message: `Transaction SP ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess SP")`,
  path: ['flowElements'],
  type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
});

verifyEngineRule('c7-transaction-start', rule, {
  valid: [
    {
      name: 'a transaction with a start event',
      moddleElement: engineModel('c7', transaction(WITH_START)),
    },
    {
      name: 'an embedded sub-process without start event (c7-start-event)',
      moddleElement: engineModel(
        'c7',
        `${START}<bpmn:subProcess id="SP"><bpmn:userTask id="T" /></bpmn:subProcess>`,
      ),
    },
    {
      name: 'a transaction without start event in a non-executable process',
      moddleElement: engineModel('c7', transaction('<bpmn:userTask id="T" />'), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a transaction without start event in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${transaction('<bpmn:userTask id="T" />')}</bpmn:adHocSubProcess>`,
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', transaction('<bpmn:userTask id="T" />')),
    },
  ],
  invalid: [
    {
      name: 'a transaction with a task but no start event',
      moddleElement: engineModel('c7', transaction('<bpmn:userTask id="T" />')),
      report: report('has no start event'),
    },
    {
      name: 'an empty transaction',
      moddleElement: engineModel('c7', `${START}<bpmn:transaction id="SP" />`),
      report: report('is empty, without a start event'),
    },
    {
      name: 'a transaction with only an event sub-process',
      moddleElement: engineModel(
        'c7',
        transaction(
          '<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ESS" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M1" /></bpmn:startEvent><bpmn:endEvent id="ESE" /><bpmn:sequenceFlow id="e1" sourceRef="ESS" targetRef="ESE" /></bpmn:subProcess>',
        ),
        { roots: MESSAGES },
      ),
      report: report('has no start event'),
    },
  ],
});

import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-called-element.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

verifyEngineRule('c7-called-element', rule, {
  valid: [
    {
      name: 'a called process or a called case',
      moddleElement: engineModel(
        'c7',
        `<bpmn:callActivity id="callActivity_a" calledElement="other" />
        <bpmn:callActivity id="callActivity_b" camunda:caseRef="case" />`,
      ),
    },
    {
      name: 'an empty calledElement (c7-bad-value)',
      moddleElement: engineModel(
        'c7',
        '<bpmn:callActivity id="callActivity_a" calledElement="" />',
      ),
    },
    {
      name: 'a non-executable process',
      moddleElement: engineModel('c7', '<bpmn:callActivity id="callActivity_a" />', {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a call activity in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        '<bpmn:adHocSubProcess id="adHocSubProcess_x"><bpmn:callActivity id="callActivity_a" /></bpmn:adHocSubProcess>',
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel('c8', '<bpmn:callActivity id="callActivity_a" />'),
    },
  ],
  invalid: [
    {
      name: 'a call activity without calledElement',
      moddleElement: engineModel('c7', '<bpmn:callActivity id="callActivity_a" />'),
      report: {
        id: 'callActivity_a',
        message:
          'Call activity callActivity_a has no calledElement (nor camunda:caseRef); the engines refuse the file',
        path: ['calledElement'],
        type: ERROR_TYPES.PROPERTY_REQUIRED,
      },
    },
    {
      name: 'a call activity with calledElement and caseRef',
      moddleElement: engineModel(
        'c7',
        '<bpmn:callActivity id="callActivity_a" calledElement="other" camunda:caseRef="case" />',
      ),
      report: {
        id: 'callActivity_a',
        message:
          'Call activity callActivity_a has both calledElement and camunda:caseRef; the engines refuse the file',
        path: ['caseRef'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
  ],
});

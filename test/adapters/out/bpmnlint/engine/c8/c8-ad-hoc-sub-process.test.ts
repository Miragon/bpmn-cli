import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-ad-hoc-sub-process.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const chain = (...middle: string[]) => `
  <bpmn:startEvent id="Start" />
  <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="X" />
  ${middle.join('\n')}
  <bpmn:sequenceFlow id="F2" sourceRef="X" targetRef="End" />
  <bpmn:endEvent id="End" />`;

const WITH_START = chain(
  '<bpmn:adHocSubProcess id="X"><bpmn:task id="A1" /><bpmn:startEvent id="AS" /></bpmn:adHocSubProcess>',
);

verifyEngineRule('c8-ad-hoc-sub-process', rule, {
  valid: [
    {
      name: 'an ad-hoc sub-process with activities only',
      moddleElement: engineModel(
        'c8',
        chain(
          '<bpmn:adHocSubProcess id="X"><bpmn:task id="A1" /><bpmn:serviceTask id="A2" /></bpmn:adHocSubProcess>',
        ),
      ),
    },
    {
      name: 'an ad-hoc sub-process without activity (camunda-compat ad-hoc-sub-process)',
      moddleElement: engineModel('c8', chain('<bpmn:adHocSubProcess id="X" />')),
    },
    {
      name: 'a start event in an ad-hoc sub-process of a process that is not executable',
      moddleElement: engineModel('c8', WITH_START, { processAttributes: 'isExecutable="false"' }),
    },
    { name: 'a Camunda 7 diagram', moddleElement: engineModel('c7', WITH_START) },
  ],
  invalid: [
    {
      name: 'an ad-hoc sub-process with a start event',
      moddleElement: engineModel('c8', WITH_START),
      report: {
        id: 'X',
        message:
          'Ad-hoc sub-process X contains the start event AS; Camunda 8 refuses start and end events in ad-hoc sub-processes',
        path: ['flowElements', 1],
        type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
      },
    },
    {
      name: 'an ad-hoc sub-process with a start and an end event',
      moddleElement: engineModel(
        'c8',
        chain(
          '<bpmn:adHocSubProcess id="X"><bpmn:startEvent id="AS" /><bpmn:task id="A1" /><bpmn:endEvent id="AE" /></bpmn:adHocSubProcess>',
        ),
      ),
      report: [
        {
          id: 'X',
          message:
            'Ad-hoc sub-process X contains the start event AS; Camunda 8 refuses start and end events in ad-hoc sub-processes',
          path: ['flowElements', 0],
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        },
        {
          id: 'X',
          message:
            'Ad-hoc sub-process X contains the end event AE; Camunda 8 refuses start and end events in ad-hoc sub-processes',
          path: ['flowElements', 2],
          type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        },
      ],
    },
  ],
});

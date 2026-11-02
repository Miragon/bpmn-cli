import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7ScopeNeedsStartEventRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-scope-needs-start-event', () => {
  const ROOTS =
    '<bpmn:signal id="Sig" name="Go" /><bpmn:message id="M" name="Pay" /><bpmn:message id="M2" name="Pay2" />';
  const MESSAGE = '<bpmn:messageEventDefinition messageRef="M" />';
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const BODY = `<bpmn:userTask id="T" /><bpmn:endEvent id="End" />${flow('F1', 'T', 'End')}`;
  const START = '<bpmn:startEvent id="Start" />';
  const missing = (id: string, message: string) => ({
    id,
    message,
    path: ['flowElements'],
    type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
  });

  verifyEngineRule(rule, {
    valid: [
      {
        name: 'none, message and signal start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${MESSAGE}</bpmn:startEvent><bpmn:startEvent id="S3"><bpmn:signalEventDefinition signalRef="Sig" /></bpmn:startEvent>${BODY}`,
          { roots: ROOTS },
        ),
      },
      {
        name: 'a transaction without start event (c7-transaction-needs-start-event)',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:transaction id="SP"><bpmn:userTask id="U" /></bpmn:transaction>`,
        ),
      },
      {
        name: 'an event sub-process without start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="ES" triggeredByEvent="true" />`,
        ),
      },
      {
        name: 'an ad-hoc sub-process: its content is skipped',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:adHocSubProcess id="SP"><bpmn:serviceTask id="X" /><bpmn:subProcess id="Z"><bpmn:userTask id="Z1" /></bpmn:subProcess><bpmn:startEvent id="A1" /><bpmn:startEvent id="A2" /></bpmn:adHocSubProcess>`,
        ),
      },
      {
        name: 'a non-executable process without start event',
        moddleElement: engineModel('c7', BODY, { processAttributes: 'isExecutable="false"' }),
      },
      {
        name: 'a Camunda 8 diagram',
        moddleElement: engineModel('c8', `${START}<bpmn:startEvent id="S2" />${BODY}`),
      },
    ],
    invalid: [
      {
        name: 'process with nodes but no start event',
        moddleElement: engineModel('c7', BODY),
        report: missing(
          'process_test',
          'Process process_test has no start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'process with only an event sub-process',
        moddleElement: engineModel(
          'c7',
          `<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES_S">${MESSAGE}</bpmn:startEvent></bpmn:subProcess>`,
          { roots: ROOTS },
        ),
        report: missing(
          'process_test',
          'Process process_test has no start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'empty process',
        moddleElement: engineModel('c7', ''),
        report: missing(
          'process_test',
          'Process process_test is empty, without a start event; the engines refuse the file (process must define a startEvent element)',
        ),
      },
      {
        name: 'sub-process with a task but no start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="Sub"><bpmn:userTask id="ST" /></bpmn:subProcess>`,
        ),
        report: missing(
          'Sub',
          'Sub-process Sub has no start event; the engines refuse the file (subProcess must define a startEvent element)',
        ),
      },
      {
        name: 'empty sub-process',
        moddleElement: engineModel('c7', `${START}<bpmn:subProcess id="SP" />`),
        report: missing(
          'SP',
          'Sub-process SP is empty, without a start event; the engines refuse the file (subProcess must define a startEvent element)',
        ),
      },
    ],
  });
});

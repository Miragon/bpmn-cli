import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';
import { describe } from 'vitest';
import rule from '../../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/C7StartEventUniqueRule.js';
import { engineModel, verifyEngineRule } from '../../../../../../helpers/engine-model.js';

describe('c7-start-event-unique', () => {
  const ROOTS =
    '<bpmn:signal id="Sig" name="Go" /><bpmn:message id="M" name="Pay" /><bpmn:message id="M2" name="Pay2" />';
  const CYCLE =
    '<bpmn:timerEventDefinition><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1H</bpmn:timeCycle></bpmn:timerEventDefinition>';
  const MESSAGE = '<bpmn:messageEventDefinition messageRef="M" />';
  const flow = (id: string, source: string, target: string) =>
    `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;
  const BODY = `<bpmn:userTask id="T" /><bpmn:endEvent id="End" />${flow('F1', 'T', 'End')}`;
  const twoStarts = (prefix: string) =>
    `<bpmn:startEvent id="${prefix}_S0" /><bpmn:startEvent id="${prefix}_S1" /><bpmn:endEvent id="${prefix}_E" />${flow(`${prefix}_f0`, `${prefix}_S0`, `${prefix}_E`)}${flow(`${prefix}_f1`, `${prefix}_S1`, `${prefix}_E`)}`;
  const START = '<bpmn:startEvent id="Start" />';
  const extra = (id: string, message: string) => ({
    id,
    message,
    type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
  });
  const secondOfProcess = (id: string) =>
    extra(
      id,
      `Start event ${id} is a second none or timer start event of process process_test (with Start); the engines allow only one and refuse the file`,
    );

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
        name: 'two none start events',
        moddleElement: engineModel('c7', `${START}<bpmn:startEvent id="S2" />${BODY}`),
        report: secondOfProcess('S2'),
      },
      {
        name: 'none and timer start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent>${BODY}`,
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'two timer start events',
        moddleElement: engineModel(
          'c7',
          `<bpmn:startEvent id="Start">${CYCLE}</bpmn:startEvent><bpmn:startEvent id="S2">${CYCLE}</bpmn:startEvent>${BODY}`,
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'a message + timer start event is a second timer start event',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:startEvent id="S2">${MESSAGE}${CYCLE}</bpmn:startEvent>${BODY}`,
          { roots: ROOTS },
        ),
        report: secondOfProcess('S2'),
      },
      {
        name: 'sub-process with two start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="Sub">${twoStarts('Sub')}</bpmn:subProcess>`,
        ),
        report: extra(
          'Sub_S1',
          'Sub-process Sub has 2 start events (Sub_S0, Sub_S1); the engines allow only one in a sub-process and refuse the file',
        ),
      },
      {
        name: 'transaction with two start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:transaction id="Sub">${twoStarts('Sub')}</bpmn:transaction>`,
        ),
        report: extra(
          'Sub_S1',
          'Transaction Sub has 2 start events (Sub_S0, Sub_S1); the engines allow only one in a sub-process and refuse the file',
        ),
      },
      {
        name: 'event sub-process with two message start events',
        moddleElement: engineModel(
          'c7',
          `${START}<bpmn:subProcess id="ES" triggeredByEvent="true"><bpmn:startEvent id="ES1">${MESSAGE}</bpmn:startEvent><bpmn:startEvent id="ES2"><bpmn:messageEventDefinition messageRef="M2" /></bpmn:startEvent></bpmn:subProcess>`,
          { roots: ROOTS },
        ),
        report: extra(
          'ES2',
          'Event sub-process ES has 2 start events (ES1, ES2); the engines allow only one in a sub-process and refuse the file',
        ),
      },
    ],
  });
});

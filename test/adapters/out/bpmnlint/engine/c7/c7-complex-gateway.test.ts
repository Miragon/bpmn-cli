import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-complex-gateway.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const flow = (id: string, from: string, target: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${target}" />`;
/** Start -> `node` (id SP) -> End */
const around = (node: string) =>
  `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'SP')}${node}${flow('F2', 'SP', 'End')}<bpmn:endEvent id="End" />`;
/** Start -> U -> End, plus `extra` that nothing connects */
const beside = (extra: string) =>
  `<bpmn:startEvent id="Start" />${flow('F1', 'Start', 'U')}<bpmn:userTask id="U" />${flow('F2', 'U', 'End')}<bpmn:endEvent id="End" />${extra}`;
const COMPLEX = '<bpmn:complexGateway id="SP" />';

const report = (end: string, flowId: string) => ({
  id: 'SP',
  message: `Complex gateway SP is connected; the engines do not run complex gateways and refuse the file (invalid ${end} 'SP' of sequence flow ${flowId})`,
  type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
});

verifyEngineRule('c7-complex-gateway', rule, {
  valid: [
    {
      name: 'a complex gateway that nothing connects',
      moddleElement: engineModel('c7', beside(COMPLEX)),
    },
    {
      name: 'a connected complex gateway in a non-executable process',
      moddleElement: engineModel('c7', around(COMPLEX), {
        processAttributes: 'isExecutable="false"',
      }),
    },
    {
      name: 'a connected complex gateway in an ad-hoc sub-process',
      moddleElement: engineModel(
        'c7',
        `<bpmn:adHocSubProcess id="AH">${around(COMPLEX)}</bpmn:adHocSubProcess>`,
      ),
    },
    { name: 'a Camunda 8 diagram', moddleElement: engineModel('c8', around(COMPLEX)) },
  ],
  invalid: [
    {
      name: 'a complex gateway with sequence flows',
      moddleElement: engineModel('c7', around(COMPLEX)),
      report: report('destination', 'F1'),
    },
    {
      name: 'a complex gateway with an outgoing flow only',
      moddleElement: engineModel('c7', beside(`${COMPLEX}${flow('F3', 'SP', 'End')}`)),
      report: report('source', 'F3'),
    },
  ],
});

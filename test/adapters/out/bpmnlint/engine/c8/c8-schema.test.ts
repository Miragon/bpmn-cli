import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c8/c8-schema.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const SCHEMA = 'Camunda 8 validates the file against the schema and refuses it';
const ID_SCHEMA = 'Camunda 8 validates the file against the BPMN schema and refuses it';
const DI_NAMESPACES =
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"';
const diagram = (shape: string) => `
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="process_test">${shape}</bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;

const attribute = (id: string, where: string, key: string, path: (string | number)[]) => ({
  id,
  message: `${where} has the attribute ${key}, which the BPMN schema does not define; ${SCHEMA}`,
  path,
  type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
});

const badId = (id: string, what: string, reason: string) => ({
  id,
  message: `${what} has the id "${id}", which is no XML NCName (${reason}); ${ID_SCHEMA}`,
  path: ['id'],
  type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
});

const COLON = 'a colon is not allowed in an id';

verifyEngineRule('c8-schema', rule, {
  valid: [
    {
      name: 'prefixed attributes and NCName ids (unknown zeebe attributes are c8-unknown-attribute)',
      moddleElement: engineModel(
        'c8',
        '<bpmn:task id="task_check.1-a" zeebe:bogus="x" /><bpmn:task id="täsk_ünïcode" />',
        {
          definitionsAttributes: DI_NAMESPACES,
          roots: diagram(
            '<bpmndi:BPMNShape id="task_check_di" bpmnElement="task_check.1-a"><dc:Bounds x="1" y="2" width="3" height="4" /></bpmndi:BPMNShape>',
          ),
        },
      ),
    },
    {
      name: 'empty extension elements on bpmn:definitions',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        roots: '<bpmn:extensionElements />',
      }),
    },
    {
      name: 'a Camunda 7 diagram',
      moddleElement: engineModel('c7', '<bpmn:task id="a:b" bad="x" />'),
    },
  ],
  invalid: [
    {
      name: 'an unprefixed attribute on a task',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="X" bad="x" />'),
      report: attribute('X', 'serviceTask X', 'bad', ['bad']),
    },
    {
      name: 'an unprefixed calledDecision on a business rule task, in a process that is not executable',
      moddleElement: engineModel(
        'c8',
        '<bpmn:businessRuleTask id="X" calledDecision="d"><bpmn:extensionElements><zeebe:calledDecision decisionId="d" resultVariable="r" /></bpmn:extensionElements></bpmn:businessRuleTask>',
        { processAttributes: 'isExecutable="false"' },
      ),
      report: attribute('X', 'businessRuleTask X', 'calledDecision', ['calledDecision']),
    },
    {
      name: 'an unprefixed attribute on an event definition with an id, reported on its event',
      moddleElement: engineModel(
        'c8',
        '<bpmn:intermediateCatchEvent id="X"><bpmn:timerEventDefinition id="TD" bad="x"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
      ),
      report: attribute('X', 'bpmn:TimerEventDefinition in X', 'bad', [
        'eventDefinitions',
        0,
        'bad',
      ]),
    },
    {
      name: 'an unprefixed attribute on a condition without id',
      moddleElement: engineModel(
        'c8',
        '<bpmn:sequenceFlow id="X" sourceRef="A" targetRef="B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="feel" bad="x">= true</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:exclusiveGateway id="A" /><bpmn:task id="B" />',
      ),
      report: attribute('X', 'bpmn:FormalExpression in X', 'bad', ['conditionExpression', 'bad']),
    },
    {
      name: 'two unprefixed attributes on bpmn:definitions',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        definitionsAttributes: 'bad="x" other="y"',
      }),
      report: [
        attribute('definitions_test', 'definitions definitions_test', 'bad', ['bad']),
        attribute('definitions_test', 'definitions definitions_test', 'other', ['other']),
      ],
    },
    {
      name: 'an unprefixed attribute on the bounds of a shape',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        definitionsAttributes: DI_NAMESPACES,
        roots: diagram(
          '<bpmndi:BPMNShape id="X_di" bpmnElement="X"><dc:Bounds x="1" y="2" width="3" height="4" bad="x" /></bpmndi:BPMNShape>',
        ),
      }),
      report: attribute('X_di', 'dc:Bounds in X_di', 'bad', ['bounds', 'bad']),
    },
    {
      name: 'extension elements on bpmn:definitions',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        roots:
          '<bpmn:extensionElements><zeebe:properties><zeebe:property name="a" value="b" /></zeebe:properties></bpmn:extensionElements>',
      }),
      report: {
        id: 'definitions_test',
        message:
          'bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file',
        path: ['extensionElements'],
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
      },
    },
    {
      name: 'a task id with a colon',
      moddleElement: engineModel('c8', '<bpmn:serviceTask id="a:b" />'),
      report: badId('a:b', 'serviceTask a:b', COLON),
    },
    {
      name: 'an id with a leading digit on a zeebe element (bpmn-moddle reads it as a string)',
      moddleElement: engineModel(
        'c8',
        '<bpmn:serviceTask id="X"><bpmn:extensionElements><zeebe:taskHeaders><zeebe:header id="1header" key="k" value="v" /></zeebe:taskHeaders></bpmn:extensionElements></bpmn:serviceTask>',
      ),
      report: badId(
        '1header',
        'zeebe:Header 1header',
        'letters, digits, _ . - and no leading digit',
      ),
    },
    {
      name: 'a shape id with a colon',
      moddleElement: engineModel('c8', '<bpmn:task id="X" />', {
        definitionsAttributes: DI_NAMESPACES,
        roots: diagram(
          '<bpmndi:BPMNShape id="X:di" bpmnElement="X"><dc:Bounds x="1" y="2" width="3" height="4" /></bpmndi:BPMNShape>',
        ),
      }),
      report: badId('X:di', 'bpmndi:BPMNShape', COLON),
    },
  ],
});

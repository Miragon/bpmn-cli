import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-result-variable.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

verifyEngineRule('c7-result-variable', rule, {
  valid: [
    {
      name: 'a result variable with an expression, a decision or a script',
      moddleElement: engineModel(
        'c7',
        `<bpmn:serviceTask id="serviceTask_a" camunda:expression="\${bean.run()}" camunda:resultVariable="result" />
        <bpmn:businessRuleTask id="businessRuleTask_b" camunda:decisionRef="risk" camunda:resultVariable="result" camunda:mapDecisionResult="singleResult" />
        <bpmn:scriptTask id="scriptTask_c" scriptFormat="groovy" camunda:resultVariable="result"><bpmn:script>1</bpmn:script></bpmn:scriptTask>`,
      ),
    },
    {
      name: 'a non-executable process',
      moddleElement: engineModel(
        'c7',
        '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:resultVariable="result" />',
        { processAttributes: 'isExecutable="false"' },
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel(
        'c8',
        '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:resultVariable="result" />',
        { definitionsAttributes: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"' },
      ),
    },
  ],
  invalid: [
    {
      name: 'a class with a result variable',
      moddleElement: engineModel(
        'c7',
        '<bpmn:serviceTask id="serviceTask_a" camunda:class="org.example.Bean" camunda:resultVariable="result" />',
      ),
      report: {
        id: 'serviceTask_a',
        message:
          'serviceTask serviceTask_a combines camunda:resultVariable with camunda:class; the engines support a result variable only with camunda:expression and refuse the file',
        path: ['resultVariable'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
    {
      name: 'a delegate expression with a result variable on a message end event',
      moddleElement: engineModel(
        'c7',
        '<bpmn:endEvent id="endEvent_done"><bpmn:messageEventDefinition camunda:delegateExpression="${notify}" camunda:resultVariable="result" /></bpmn:endEvent>',
      ),
      report: {
        id: 'endEvent_done',
        message:
          'endEvent:message endEvent_done combines camunda:resultVariable with camunda:delegateExpression; the engines support a result variable only with camunda:expression and refuse the file',
        path: ['eventDefinitions', 0, 'resultVariable'],
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
      },
    },
  ],
});

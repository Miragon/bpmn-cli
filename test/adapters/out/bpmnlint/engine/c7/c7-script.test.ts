import { ERROR_TYPES } from 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js';

import rule from '../../../../../../src/adapters/out/bpmnlint/engine/rules/c7/c7-script.js';
import { engineModel, verifyEngineRule } from '../../../../../helpers/engine-model.js';

const REPORT = {
  id: 'scriptTask_a',
  message:
    'Script task scriptTask_a has neither a script nor camunda:resource; the engines refuse the file',
  path: ['script'],
  type: ERROR_TYPES.PROPERTY_REQUIRED,
};

verifyEngineRule('c7-script', rule, {
  valid: [
    {
      name: 'an inline script or a script resource',
      moddleElement: engineModel(
        'c7',
        `<bpmn:scriptTask id="scriptTask_a" scriptFormat="groovy"><bpmn:script>println 1</bpmn:script></bpmn:scriptTask>
        <bpmn:scriptTask id="scriptTask_b" scriptFormat="groovy" camunda:resource="deployment://b.groovy" />`,
      ),
    },
    {
      name: 'a non-executable process',
      moddleElement: engineModel(
        'c7',
        '<bpmn:scriptTask id="scriptTask_a" scriptFormat="groovy" />',
        {
          processAttributes: 'isExecutable="false"',
        },
      ),
    },
    {
      name: 'a Camunda 8 diagram',
      moddleElement: engineModel(
        'c8',
        '<bpmn:scriptTask id="scriptTask_a" scriptFormat="groovy" />',
      ),
    },
  ],
  invalid: [
    {
      name: 'a script task without script',
      moddleElement: engineModel(
        'c7',
        '<bpmn:scriptTask id="scriptTask_a" scriptFormat="groovy" />',
      ),
      report: REPORT,
    },
    {
      name: 'a script task with a blank script',
      moddleElement: engineModel(
        'c7',
        '<bpmn:scriptTask id="scriptTask_a" scriptFormat="groovy"><bpmn:script>  </bpmn:script></bpmn:scriptTask>',
      ),
      report: REPORT,
    },
  ],
});

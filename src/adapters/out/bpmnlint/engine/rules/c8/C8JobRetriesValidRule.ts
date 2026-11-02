import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Values } from '../support/Values.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

const JOB_TASKS = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask'];

/**
 * Job retries of a zeebe:taskDefinition that are neither a number nor a FEEL expression.
 * Camunda 8 deploys the file, but every instance gets an incident when it reaches the element.
 *
 * @example retries that are no number
 * <zeebe:taskDefinition type="charge" retries="three" />  <!-- incident on every instance -->
 */
class C8JobRetriesValidRule extends C8Rule {
  protected visit(node: ModdleElement): void {
    if (!this.isJobHost(node) || !EngineScope.C8.runs(node)) return;
    const [taskDefinition] = C8Host.valuesOf(node, 'zeebe:TaskDefinition');
    const retries = taskDefinition?.retries;
    if (retries === undefined || Values.isFeel(retries) || /^\s*-?\d+\s*$/.test(retries)) {
      return;
    }
    this.report(node, `The ${ZeebeHint.prefixOf(node)}:taskDefinition of ${ElementKinds.describe(node)} has retries="${retries}", which is no number; it deploys, but every instance gets an incident when it reaches ${node.id}`, { path: [...ModdlePath.between(node, taskDefinition), 'retries'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: taskDefinition, property: 'retries', hint: ZeebeHint.of(node)?.replace(taskDefinition, { retries: '3' }) ?? 'edit the XML.' });
  }

  private isJobHost(node: ModdleElement): boolean {
    return isAny(node, JOB_TASKS) || (is(node, 'bpmn:ThrowEvent') && !!C8EventDefinitions.definitionOfType(node, 'bpmn:MessageEventDefinition'));
  }
}

export default defineRule({ ruleName: 'c8-job-retries-valid', code: 'W_C8_BAD_VALUE', impact: 'runtime' }, C8JobRetriesValidRule);

import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { Shell } from '../support/Shell.js';
import { C7Links } from './support/C7Links.js';

/**
 * A link throw event a sequence flow reaches without a link catch event of its name in its own
 * (sub-)process.
 * Camunda 7 resolves links within one (sub-)process and refuses to deploy the file.
 *
 * @example a link throw without catch
 * <bpmn:intermediateThrowEvent id="GoShip"><bpmn:linkEventDefinition name="Shipping" /></bpmn:intermediateThrowEvent>  <!-- no catch named Shipping -->
 */
class C7LinkThrowNeedsCatchRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (!is(node, 'bpmn:Process') || !EngineScope.C7.contains(node)) return;
    const links = C7Links.of(node);
    const targets = this.flowTargets(node);
    for (const { el, name, scope } of links.unmatchedThrows()) {
      if (!targets.has(el)) continue;
      const elsewhere = links.catchNamed(name);
      const scopeId = scope.id ?? '<scopeId>';
      const missing = elsewhere ? `the catch event of that name (${elsewhere.id}) is in another scope` : 'no link catch event has that name';
      this.report(el, `Link throw event ${el.id} jumps to "${name}", but ${missing}; the engines resolve links within one (sub-)process (${scopeId}) and refuse the file`, { path: C7Links.namePath(el), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'name', ...(elsewhere ? { elsewhere } : {}), hint: `Add the catching side in ${scopeId}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scopeId} --link ${Shell.quote(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${el.id} link=<Name>\`.` });
    }
  }

  /** The flow nodes a sequence flow of the process leads to. */
  private flowTargets(scope: ModdleElement, targets = new Set<ModdleElement>()): Set<ModdleElement> {
    for (const element of scope.flowElements ?? []) {
      if (is(element, 'bpmn:SequenceFlow') && element.targetRef) {
        targets.add(element.targetRef);
      }
      if (element.flowElements) this.flowTargets(element, targets);
    }
    return targets;
  }
}

export default defineRule({ ruleName: 'c7-link-throw-needs-catch', code: 'W_C7_DEPLOY_LINK', impact: 'deploy' }, C7LinkThrowNeedsCatchRule);

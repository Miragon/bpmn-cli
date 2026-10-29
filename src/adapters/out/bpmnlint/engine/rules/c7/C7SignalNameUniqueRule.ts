import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { FirstOfKey } from '../support/FirstOfKey.js';

/**
 * Two signals of the file with one name, even of an unused signal, once a process is executable.
 * Camunda 7 refuses duplicate signal names and does not deploy the file.
 *
 * @example two signals with one name
 * <bpmn:signal id="Fire" name="Alarm" />
 * <bpmn:signal id="Smoke" name="Alarm" />
 */
class C7SignalNameUniqueRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (!is(node, 'bpmn:Definitions')) return;
    const roots: ModdleElement[] = node.rootElements ?? [];
    if (!roots.some((root) => is(root, 'bpmn:Process') && root.isExecutable === true)) {
      return;
    }
    const firsts = new FirstOfKey<ModdleElement>();
    for (const signal of roots.filter((root) => is(root, 'bpmn:Signal') && root.name)) {
      const first = firsts.repeats(signal.name, signal);
      if (first) {
        this.report(signal, `Signals ${first.id} and ${signal.id} are both named "${signal.name}"; the engines refuse duplicate signal names`, { path: ['name'], type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED, duplicatedProperty: 'name', duplicatedPropertyValue: signal.name, first, hint: `\`bpmn set <file> ${signal.id} name=<OtherName>\` (or point its events at ${first.id} and remove it).` });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-signal-name-unique', code: 'W_C7_DEPLOY_SIGNAL', impact: 'deploy' }, C7SignalNameUniqueRule);

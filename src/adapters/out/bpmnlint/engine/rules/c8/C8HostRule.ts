import { C8Rule, type ModdleElement, type ReportData } from '../CamundaRule.js';
import { C8Host } from './support/C8Host.js';

/**
 * The elements whose zeebe content Camunda 8 reads (`C8Host`), for the rules on that content: its
 * extension elements, listeners, bindings and attributes. A finding goes on the element it lands
 * on (an event definition's on its event).
 * Camunda 8 refuses or ignores content it cannot read where it sits.
 *
 * @example task listeners on a job worker user task
 * <bpmn:userTask id="Review">
 *   <bpmn:extensionElements><zeebe:taskListeners>...</zeebe:taskListeners></bpmn:extensionElements>  <!-- no zeebe:userTask -->
 * </bpmn:userTask>
 */
export abstract class C8HostRule extends C8Rule {
  protected visit(node: ModdleElement): void {
    const host = C8Host.of(node);
    if (host) this.checkHost(host);
  }

  protected abstract checkHost(host: C8Host): void;

  /** A finding about content of `host`, which names `host.node` unless it names a part of it. */
  protected reportContent(host: C8Host, message: string, { path, ...data }: ReportData): void {
    this.report(host.target, message, { node: host.node, path, ...data });
  }

  /** How to rebuild a zeebe element with child elements (`zeebe:linkedResources`). */
  protected rebuildHint(host: C8Host, element: ModdleElement): string {
    const hint = host.hint();
    return hint ? hint.rebuild(hint.nameOf(element)) : 'Fix it in the XML.';
  }
}

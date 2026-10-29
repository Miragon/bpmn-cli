import { ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';

/**
 * The listeners of one zeebe listener list an element reads, for the rules on their event type
 * (`C8ExecutionListenerEventTypeValidRule`, `C8TaskListenerEventTypeValidRule`): a finding is
 * reported on the event type, and its fix rebuilds the listener in its list.
 * Camunda 8 refuses a listener without event type or with one it does not run there.
 *
 * @example an execution listener without event type
 * <zeebe:executionListeners><zeebe:executionListener type="audit" /></zeebe:executionListeners>  <!-- eventType="start" -->
 */
export abstract class C8ListenerEventTypeRule extends C8HostRule {
  /** The zeebe list this rule checks (`zeebe:executionListeners`). */
  protected abstract readonly list: string;

  protected checkHost(host: C8Host): void {
    for (const { value, index, type, placement } of host.zeebeValues()) {
      if (placement === 'read' && type.name === this.list) {
        this.checkListeners(host, value, index);
      }
    }
  }

  protected abstract checkListeners(host: C8Host, value: ModdleElement, index: number): void;

  protected reportEventType(host: C8Host, listener: ModdleElement, index: number, listenerIndex: number, message: string, hint: string, missing = false): void {
    const path = host.extensionPath(index, 'listeners', listenerIndex, 'eventType');
    this.reportOn(host, message, missing ? { path, type: ERROR_TYPES.PROPERTY_REQUIRED, node: listener, requiredProperty: 'eventType', hint } : { path, type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: listener, property: 'eventType', hint });
  }

  /** `<lead>: <remove the listener>, then <add it again with fix>`: the listener is rebuilt in its list (`zeebe:taskListeners/zeebe:taskListener[0]`). */
  protected rebuildListenerHint(host: C8Host, listenerLocal: 'executionListener' | 'taskListener', listenerIndex: number, lead: string, fix: string): string {
    const hint = host.hint();
    if (!hint) return `${lead}: remove it from the XML, then edit the XML.`;
    const listener = `${hint.name(`${listenerLocal}s`)}/${hint.name(listenerLocal)}`;
    return `${lead}: ${hint.extRemove(`${listener}[${listenerIndex}]`)}, then ${hint.extAdd(`${listener} ${fix}`)}.`;
  }
}

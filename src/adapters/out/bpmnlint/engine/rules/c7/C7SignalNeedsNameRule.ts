import { defineRule } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * A signal without name that a signal event references.
 * Camunda 7 broadcasts signals by name and refuses to deploy the file.
 *
 * @example a signal without name
 * <bpmn:signal id="Alarm" />  <!-- name="Alarm" -->
 */
class C7SignalNeedsNameRule extends C7EventReferenceRule {
  protected readonly kind = 'Signal';
  protected readonly events = ['bpmn:Event'];

  protected checkReference({ event, referenced, path }: EventReference): void {
    if (referenced && !referenced.name) {
      this.reportUnnamed(event, referenced, `Signal ${referenced.id} of ${ElementKinds.describe(event)}`, path);
    }
  }
}

export default defineRule({ ruleName: 'c7-signal-needs-name', code: 'W_C7_DEPLOY_SIGNAL', impact: 'deploy' }, C7SignalNeedsNameRule);

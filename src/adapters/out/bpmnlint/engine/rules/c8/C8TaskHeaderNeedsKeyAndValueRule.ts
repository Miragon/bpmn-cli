import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/**
 * A task header without key or value, of an element or of its execution listeners (not on a
 * sequence flow).
 * Camunda 8 deploys the file and drops the header: the job does not carry it.
 *
 * @example a task header without value
 * <zeebe:taskHeaders><zeebe:header key="region" /></zeebe:taskHeaders>  <!-- no value -->
 */
class C8TaskHeaderNeedsKeyAndValueRule extends C8Rule {
  protected visit(host: ModdleElement): void {
    for (const value of host.extensionElements?.values ?? []) {
      if (isAny(value, ['zeebe:TaskHeaders', 'zeebe:ExecutionListeners']) && C8Host.readHostOf(value)) {
        this.checkHeaderValues(value, host);
      }
    }
  }

  /** Task headers without key or value, of the host or of its execution listeners (not on a sequence flow). */
  private checkHeaderValues(value: ModdleElement, host: ModdleElement): void {
    if (is(value, 'zeebe:TaskHeaders')) {
      this.checkHeaderValuesOf(value, host, '');
    } else if (!is(host, 'bpmn:SequenceFlow')) {
      (value.listeners ?? []).forEach((listener: ModdleElement, index: number) => listener.headers && this.checkHeaderValuesOf(listener.headers, host, `execution listener ${index + 1} of `));
    }
  }

  private checkHeaderValuesOf(headers: ModdleElement, host: ModdleElement, inListener: string): void {
    const owner = ModdlePath.ownerOf(host);
    const where = `${inListener}${host.id ? ElementKinds.describe(host) : ElementKinds.describe(host, owner)}`;
    const hint = host.id && !inListener ? ZeebeHint.of(host) : undefined;
    (headers.values ?? []).forEach((header: ModdleElement, index: number) => {
      const missing = (['key', 'value'] as const).find((property) => !Values.nonEmpty(header[property]));
      if (missing) {
        this.report(owner, `Task header ${header.key ? `"${header.key}"` : index + 1} of ${where} has no ${missing}; Camunda 8 drops it, the job does not carry it`, { path: [...ModdlePath.between(owner, header), missing], type: ERROR_TYPES.PROPERTY_REQUIRED, node: header, requiredProperty: missing, hint: hint ? this.headerValueHint(hint, header, index, missing) : 'Fix it in the XML.' });
      }
    });
  }

  /** Re-add a header without key (after removing it) or without value: `bpmn ext add` replaces the header of its key. */
  private headerValueHint(hint: ZeebeHint, header: ModdleElement, index: number, missing: 'key' | 'value'): string {
    const add = hint.extAdd(`${hint.name('header')} key=${header.key ?? '<key>'} value=<value>`);
    if (missing === 'value') return `Give it a value: ${add}.`;
    return `Remove it (\`bpmn ext remove <file> ${hint.id} ${Shell.quote(`${hint.name('taskHeaders')}/${hint.name('header')}[${index}]`)}\`) and add it with a key: ${add}.`;
  }
}

export default defineRule({ ruleName: 'c8-task-header-needs-key-and-value', code: 'W_C8_BAD_VALUE', impact: 'runtime' }, C8TaskHeaderNeedsKeyAndValueRule);

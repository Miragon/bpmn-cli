import { defineRule, ERROR_TYPES, type ReportData } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { DidYouMean } from '../support/DidYouMean.js';
import { Shell } from '../support/Shell.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/** Zeebe elements Camunda 8 accepts but does not execute: no home for an attribute. */
const NOT_EXECUTED = ['zeebe:publishMessage'];

/**
 * A zeebe attribute that does not exist, on a BPMN element or on a zeebe extension element (or one
 * inside it). On a BPMN element, the hint moves it to the extension element that has it.
 * Camunda 8 deploys the file and silently ignores the attribute.
 *
 * @example a zeebe attribute on the task instead of its task definition
 * <bpmn:serviceTask id="Charge" zeebe:type="charge" />  <!-- zeebe:taskDefinition type="charge" -->
 */
class C8ZeebeAttributeKnownRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    this.checkUnknownAttributes(host);
    this.checkUnknownTreeAttributes(host);
  }

  /** A zeebe attribute of the BPMN element the descriptor does not define, moved to the extension element that has it. */
  private checkUnknownAttributes(host: C8Host): void {
    const zeebe = RuleKit.kit.ZEEBE;
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const key of host.zeebeAttributeKeys()) {
      const local = key.slice(key.indexOf(':') + 1);
      if (zeebe.attr(local)) continue;
      const home = zeebe.typeNames().map((name) => zeebe.type(name)!).find((type) => !NOT_EXECUTED.includes(type.name) && zeebe.allowedOn(type.name, host.node) === true && type.attributes.some(({ name }) => name === local));
      const homeName = home && `${prefix}:${home.name.slice('zeebe:'.length)}`;
      const guess = home ? undefined : DidYouMean.of(local, zeebe.attrs().map(({ name }) => name.slice('zeebe:'.length)));
      const unset = hint ? hint.unset(`${prefix}:${local}`) : 'edit the XML';
      const move = home && hint ? hint.extAdd(`${homeName} ${Shell.quote(`${local}=${host.node.$attrs[key] ?? ''}`)}`) : 'edit the XML';
      this.reportUnknownAttribute(host, host.describe(), `${prefix}:${local}`, { property: key, path: host.path(key), hint: home ? `Move it: ${unset}, then ${move}.` : `Remove it: ${unset}.` }, guess ? ` (did you mean ${prefix}:${guess}?)` : '', home ? ` (it reads ${local} on the ${homeName} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)');
    }
  }

  /** An attribute a zeebe extension element (or one inside it) does not have. */
  private checkUnknownTreeAttributes(host: C8Host): void {
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const { value, index, placement } of host.zeebeValues()) {
      if (placement !== 'read') continue;
      const rebuild = hint ? hint.rebuild(hint.nameOf(value)) : 'Fix it in the XML.';
      for (const element of host.tree(value, prefix, host.extensionPath(index))) {
        const names = RuleKit.kit.ZEEBE.type(element.element.$type)?.attributes.map(({ name }) => name);
        for (const key of names ? Object.keys(element.element.$attrs ?? {}) : []) {
          if (!key.includes(':') && !key.startsWith('xmlns')) {
            this.reportUnknownAttribute(host, element.where, key, { property: key, path: [...element.path, key], node: element.element, hint: rebuild }, DidYouMean.suggestion(key, names!));
          }
        }
      }
    }
  }

  /** `name` on `where`, which the descriptor does not know; `suggestion` names the one it most likely means, `after` where Camunda 8 reads it. */
  private reportUnknownAttribute(host: C8Host, where: string, name: string, data: Pick<ReportData, 'path'> & Record<string, unknown>, suggestion: string, after = ''): void {
    this.reportContent(host, `${where} has the unknown attribute ${name}${suggestion}; Camunda 8 ignores it${after}`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }
}

export default defineRule({ ruleName: 'c8-zeebe-attribute-known', code: 'W_C8_UNKNOWN_ATTRIBUTE', impact: 'runtime' }, C8ZeebeAttributeKnownRule);

import { defineRule, ERROR_TYPES, type ModdleElement, type ReportData } from '../CamundaRule.js';
import { RuleKit } from '../RuleKit.js';
import { CAMUNDA_URI } from '../support/DiagramNamespaces.js';
import { DidYouMean } from '../support/DidYouMean.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Shell } from '../support/Shell.js';
import { C7VendorContentRule } from './C7VendorContentRule.js';
import { CamundaPlacement } from './support/CamundaPlacement.js';
import type { C7Host } from './support/C7Host.js';

/** Attributes the engines read that the descriptor knows as child elements only. */
const EXTRA_ATTRIBUTES: Record<string, string[]> = { 'camunda:Field': ['expression'] };

/**
 * A camunda attribute that does not exist, on a BPMN element or inside a camunda extension element
 * the engines read, with the one it most likely means.
 * Camunda 7 deploys the file and ignores it.
 *
 * @example a typo in an attribute name
 * <bpmn:userTask id="Review" camunda:asignee="demo" />  <!-- nobody gets assigned -->
 */
class C7CamundaAttributeKnownRule extends C7VendorContentRule {
  private readonly camunda = RuleKit.kit.CAMUNDA;

  protected checkHost(host: C7Host): void {
    this.checkUnknownAttributes(host);
    if (host.isDefinitions()) return;
    for (const extension of new CamundaPlacement(host).readExtensions()) {
      for (const { element, where, path, key } of host.treeAttributes(extension)) {
        if (!key.includes(':')) {
          this.reportUnknownAttribute(host, where, key, { property: key, path: [...path, key], node: element, hint: host.rebuild(extension) }, DidYouMean.suggestion(key, this.attributeNamesOf(element)));
        }
      }
    }
  }

  /** A camunda attribute the descriptor does not know: rename it to the one it most likely means, else remove it. */
  private checkUnknownAttributes(host: C7Host): void {
    for (const { key, local, uri } of host.foreignAttributes()) {
      if (uri !== CAMUNDA_URI || this.camunda.attr(local)) continue;
      const prefix = key.slice(0, key.indexOf(':'));
      const names = this.camunda.attrs().map(({ name }) => name.slice(name.indexOf(':') + 1));
      const applicable = names.filter((name) => this.camunda.attr(name)!.owners.some((owner) => host.node.$instanceOf(owner)));
      const guess = DidYouMean.of(local, names, applicable);
      const fits = guess !== undefined && applicable.includes(guess);
      const unset = host.address && `bpmn set <file> ${host.address.id} ${Shell.quote(`${host.address.slot}${key}=`)}`;
      const rename = fits ? ` ${Shell.quote(`${host.address?.slot}${prefix}:${guess}=${String(host.node.$attrs[key] ?? '')}`)}` : '';
      const hint = unset ? `${rename ? 'Rename' : 'Remove'} it: \`${unset}${rename}\`.` : 'Remove it: edit the XML.';
      this.reportUnknownAttribute(host, host.describe(), key, { property: `camunda:${local}`, path: host.path(`camunda:${local}`), hint }, guess ? ` (did you mean ${prefix}:${guess}?${fits ? '' : ` It applies to ${ElementKinds.list(this.camunda.attr(guess)?.owners ?? [], 4)} only.`})` : '');
    }
  }

  /** The attributes of a camunda element: its descriptor's, and the ones the engines read that it knows as child elements only. */
  private attributeNamesOf(element: ModdleElement): string[] {
    const names: string[] = (element.$descriptor?.properties ?? []).filter((property: { isAttr?: boolean; isReference?: boolean; isMany?: boolean }) => property.isAttr || (property.isReference && !property.isMany)).map((property: { name: string; ns?: { localName?: string } }) => property.ns?.localName ?? property.name);
    return [...new Set([...names, ...(EXTRA_ATTRIBUTES[element.$type] ?? [])])];
  }

  /** `name` on `where`, which the descriptor does not know; `suggestion` names the one it most likely means. */
  private reportUnknownAttribute(host: C7Host, where: string, name: string, data: Pick<ReportData, 'path'> & Record<string, unknown>, suggestion: string): void {
    this.reportContent(host, `${where} has the unknown attribute ${name}${suggestion}; the engines ignore it`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }
}

export default defineRule({ ruleName: 'c7-camunda-attribute-known', code: 'W_C7_UNKNOWN_ATTRIBUTE', impact: 'runtime' }, C7CamundaAttributeKnownRule);

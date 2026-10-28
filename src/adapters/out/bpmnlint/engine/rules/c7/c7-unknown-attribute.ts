import { defineRule, ERROR_TYPES, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7Host, CAMUNDA_URI } from './extensions/C7Host.js';
import { C7HostRule } from './extensions/C7HostRule.js';
import { CamundaDescriptor } from './extensions/CamundaDescriptor.js';
import { CamundaElementTree } from './extensions/CamundaElementTree.js';
import { CamundaPlacement } from './extensions/CamundaPlacement.js';
import { ExtensionHints } from './extensions/ExtensionHints.js';
import { sh } from '../shell.js';
import { didYouMean } from '../didYouMean.js';
import { kindsText } from './extensions/utils/kindsText.js';

/** Attributes the engines read that the descriptor knows as child elements only. */
const EXTRA_ATTRIBUTES: Record<string, string[]> = { 'camunda:Field': ['expression'] };

/**
 * Reports camunda attributes the descriptor does not know (a typo such as camunda:asignee), on a
 * BPMN element or on a camunda extension element; the Camunda 7 engines ignore them.
 */
class C7UnknownAttribute extends C7HostRule {
  private readonly descriptor = CamundaDescriptor.get();

  protected checkHost(host: C7Host, reporter: Reporter): void {
    this.checkAttributes(host, reporter);
    if (!host.isDefinitions()) {
      this.checkExtensions(host, reporter);
    }
  }

  private checkAttributes(host: C7Host, reporter: Reporter): void {
    const hints = new ExtensionHints(host);
    for (const { key, local, uri } of host.foreignAttributes()) {
      if (uri !== CAMUNDA_URI || this.descriptor.ownersOf(local)) {
        continue;
      }
      const prefix = key.slice(0, key.indexOf(':'));
      const applicable = this.descriptor.attributeNamesFor(host.node);
      const guess = didYouMean(local, this.descriptor.attributeNames(), applicable);
      const fits = guess !== undefined && applicable.includes(guess);
      const value = String(host.node.$attrs[key] ?? '');
      host.report(reporter, {
        message: `${host.describe()} has the unknown attribute ${key}${this.suggestion(prefix, guess, fits)}; the engines ignore it`,
        path: host.path(`camunda:${local}`),
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        property: `camunda:${local}`,
        hint: this.hint(hints, key, fits ? `${prefix}:${guess}=${value}` : undefined),
      });
    }
  }

  /** Rename it to the attribute it most likely means (`rename`: `camunda:assignee=demo`), else remove it. */
  private hint(hints: ExtensionHints, key: string, rename: string | undefined): string {
    const address = hints.address;
    if (!address) {
      return 'Remove it: edit the XML.';
    }
    const unset = `bpmn set <file> ${address.id} ${sh(`${address.slot}${key}=`)}`;
    return rename
      ? `Rename it: \`${unset} ${sh(`${address.slot}${rename}`)}\`.`
      : `Remove it: \`${unset}\`.`;
  }

  /** ` (did you mean camunda:assignee?)`, with where it applies when not on the host. */
  private suggestion(prefix: string, guess: string | undefined, fits: boolean): string {
    if (!guess) {
      return '';
    }
    const elsewhere = fits ? '' : ` It applies to ${kindsText(this.descriptor.ownersOf(guess) ?? [])} only.`;
    return ` (did you mean ${prefix}:${guess}?${elsewhere})`;
  }

  private checkExtensions(host: C7Host, reporter: Reporter): void {
    const placement = new CamundaPlacement(host);
    const hints = new ExtensionHints(host);
    for (const extension of placement.readExtensions()) {
      const rebuild = hints.rebuild(extension);
      for (const { element, where, path, key } of new CamundaElementTree(host, extension).foreignAttributes()) {
        if (key.includes(':')) {
          continue;
        }
        const guess = didYouMean(key, this.attributeNamesOf(element));
        host.report(reporter, {
          message: `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`,
          path: [...path, key],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node: element,
          property: key,
          hint: rebuild,
        });
      }
    }
  }

  private attributeNamesOf(element: ModdleElement): string[] {
    const names: string[] = (element.$descriptor?.properties ?? [])
      .filter((property: any) => property.isAttr || (property.isReference && !property.isMany))
      .map((property: any) => property.ns?.localName ?? property.name);
    return [...new Set([...names, ...(EXTRA_ATTRIBUTES[element.$type] ?? [])])];
  }
}

export default defineRule(
  { ruleName: 'c7-unknown-attribute', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7UnknownAttribute,
);

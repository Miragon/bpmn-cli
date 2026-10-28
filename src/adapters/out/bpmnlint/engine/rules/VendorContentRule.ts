import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { CamundaRule, ERROR_TYPES, type ModdleElement, type ReportPath } from './CamundaRules.js';
import { didYouMean } from './didYouMean.js';
import type { TreeElement, VendorHost } from './VendorHost.js';

/** How an engine's vendor-content findings name it and the other engine. */
const PHRASES: Record<Engine, { name: string; other: string; ignoresIt: string; readsIt: string }> = {
  c7: { name: 'Camunda 7', other: 'Camunda 8', ignoresIt: 'the engines ignore it', readsIt: 'the engines read it on' },
  c8: { name: 'Camunda 8', other: 'Camunda 7', ignoresIt: 'Camunda 8 ignores it', readsIt: 'Camunda 8 reads it on' },
};

/** Where a vendor-content finding points and how to fix it. */
interface Finding {
  path: ReportPath;
  hint: string;
  node?: ModdleElement;
  [detail: string]: unknown;
}

/**
 * The vendor-content findings both engines share, worded with the engine's phrases: content of the
 * other engine, attributes its descriptor does not know, attributes and extension elements where
 * the engine does not read them. The engine finds them and gives the fixes.
 */
export abstract class VendorContentRule extends CamundaRule {
  private get phrases(): (typeof PHRASES)[Engine] {
    return PHRASES[this.engine];
  }

  /** `key` (as the file spells it) of the other engine on `where`, `property` as the finding names it. */
  protected reportForeignAttribute(host: VendorHost, where: string, key: string, property: string, finding: Finding): void {
    this.reportOn(host, 'foreign-content', `${where} carries the ${this.phrases.other} attribute ${key}, which ${this.phrases.name} ignores`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property, ...finding });
  }

  protected reportForeignExtension(host: VendorHost, type: string, extensionElement: ModdleElement, finding: Finding): void {
    this.reportOn(host, 'foreign-content', `${host.describe()} contains the ${this.phrases.other} extension ${type}, which ${this.phrases.name} ignores`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement, ...finding });
  }

  /** `name` on `where`, which the descriptor does not know; `suggestion` and `after` frame the message. */
  protected reportUnknownAttribute(host: VendorHost, where: string, name: string, property: string, finding: Finding, suggestion = '', after = ''): void {
    this.reportOn(host, 'unknown-attribute', `${where} has the unknown attribute ${name}${suggestion}; ${this.phrases.ignoresIt}${after}`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property, ...finding });
  }

  /** An unprefixed attribute `key` of a vendor element inside an extension element, the closest of `names` as the guess. */
  protected reportUnknownTreeAttribute(host: VendorHost, { element, where, path }: TreeElement, key: string, names: string[], hint: string): void {
    const guess = didYouMean(key, names);
    this.reportUnknownAttribute(host, where, key, key, { path: [...path, key], node: element, hint }, guess ? ` (did you mean ${guess}?)` : '');
  }

  /** `name` on the host, which the engine reads on `readOn` only. */
  protected reportMisplacedAttribute(host: VendorHost, name: string, readOn: string, property: string, finding: Finding): void {
    this.reportOn(host, 'misplaced-attribute', `${name} on ${host.describe()} has no effect: ${this.phrases.readsIt} ${readOn} only`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property, ...finding });
  }

  /** The extension element `type` on the host, which the engine reads on `readOn` only. */
  protected reportMisplacedExtension(host: VendorHost, type: string, readOn: string, extensionElement: ModdleElement, finding: Finding): void {
    this.reportOn(host, 'misplaced-extension', `${type} on ${host.describe()} has no effect: ${this.phrases.readsIt} ${readOn} only`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement, ...finding });
  }

  /** The extension element `type` loose in the host's extension elements instead of inside `containers`. */
  protected reportLooseExtension(host: VendorHost, type: string, containers: string, extensionElement: ModdleElement, finding: Finding): void {
    this.reportOn(host, 'misplaced-extension', `${type} sits directly in the extension elements of ${host.describe()}, but belongs inside ${containers}; ${this.phrases.ignoresIt}`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement, ...finding });
  }

  protected reportOn(host: VendorHost, kind: string, message: string, { path, ...data }: Finding & { type: string }): void {
    this.report(`${this.engine}-${kind}`, host.target, message, { node: host.node, path, ...data });
  }
}

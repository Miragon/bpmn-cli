import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';

import type { El } from '../../../../domain/document/utils/moddle.js';


import type { DocumentNamespaces } from '../../../../domain/document/vendor/DocumentNamespaces.js';
import type { EngineKit } from '../engine-kit.js';

/** How `bpmn set` addresses a nested element of a flow node or flow. */
const SLOTS: Array<[string, string]> = [['eventDefinitions', 'definition.'], ['loopCharacteristics', 'loop.'], ['conditionExpression', 'condition.']];

/**
 * camunda booleans other than the exact `true` / `false`: the engines read only `true`, so
 * `yes` or `TRUE` leave a setting off. A typed parse turns such a value into `false` before a
 * bpmnlint rule sees it; bpmn-cli's model keeps the text.
 */
export class CamundaBooleans {
  private readonly ns: DocumentNamespaces;

  constructor(private readonly kit: EngineKit, private readonly doc: Doc) {
    this.ns = new this.kit.DocumentNamespaces(doc);
  }

  findings(): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    for (const el of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      this.checkAttributes(el, out);
      for (const value of this.kit.list(this.kit.peek<El>(el, 'extensionElements'), 'values')) this.checkVendorElement(el, value, '', out);
    }
    return out;
  }

  private checkAttributes(el: El, out: ProfileFinding[]): void {
    for (const [key, raw] of Object.entries(el.$attrs ?? {})) {
      if (!this.kit.CAMUNDA.reads(this.ns.uriOfName(key))) continue;
      const def = this.kit.CAMUNDA.attr(key.slice(key.indexOf(':') + 1));
      if (def?.type !== 'Boolean' || !def.owners.some((ownerType) => this.kit.is(el, ownerType))) continue;
      const value = String(raw ?? '');
      if (value === 'true' || value === 'false') continue;
      const address = this.addressOf(el);
      out.push(this.kit.makeFinding('runtime', 'W_C7_BAD_VALUE', `${key}="${value}" on ${this.describe(el)} is not true or false; the engines read only the exact value true (yes, TRUE or True leave it off)`, address?.id, { subject: `attr:${key}`, hint: address ? `\`bpmn set <file> ${address.id} ${address.slot}${key}=true\` (or =false).` : 'Use true or false in the XML.' }));
    }
  }

  private checkVendorElement(host: El, vendorElement: El, path: string, out: ProfileFinding[]): void {
    if (!this.kit.CAMUNDA.reads(this.ns.uriOfElement(vendorElement))) return;
    const local = vendorElement.$type.slice(vendorElement.$type.indexOf(':') + 1);
    const vendorType = this.kit.CAMUNDA.type(local);
    if (!vendorType) return;
    for (const property of vendorType.properties) {
      if (property.type !== 'Boolean' || !property.isAttr) continue;
      const raw = this.kit.peek<unknown>(vendorElement, property.name);
      if (raw === undefined || raw === true || raw === false || raw === 'true' || raw === 'false') continue;
      const address = this.addressOf(host);
      out.push(this.kit.makeFinding('runtime', 'W_C7_BAD_VALUE', `${property.name}="${String(raw)}" on ${vendorElement.$type}${path ? ` (in ${path})` : ''} of ${this.describe(host)} is not true or false; the engines read only the exact value true`, address?.id, { subject: `ext:${path}/${local}@${property.name}`, hint: address ? `See it with \`bpmn ext list <file> ${address.id} --json\`, then rebuild it with \`bpmn ext add <file> ${address.id} ... --replace\` and ${property.name}=true (or false).` : 'Use true or false in the XML.' }));
    }
    for (const child of this.kit.list(vendorElement, '$children')) this.checkVendorElement(host, child, path ? `${path} > ${vendorElement.$type}` : vendorElement.$type, out);
  }

  /** The element `bpmn set` names, and the slot of a nested element in it. */
  private addressOf(el: El): { id: string; slot: string } | undefined {
    const id = this.kit.peek<string>(el, 'id');
    const parent = el.$parent as El | undefined;
    const parentId = parent ? this.kit.peek<string>(parent, 'id') : undefined;
    const slot = parent && parentId ? SLOTS.find(([property]) => { const value = this.kit.peek<unknown>(parent, property); return Array.isArray(value) ? value.includes(el) : value === el; }) : undefined;
    if (slot && parentId) return { id: parentId, slot: slot[1] };
    return id ? { id, slot: '' } : undefined;
  }

  private describe(el: El): string {
    const local = el.$type.slice(el.$type.indexOf(':') + 1);
    const id = this.kit.peek<string>(el, 'id');
    return id ? `${local.charAt(0).toLowerCase()}${local.slice(1)} ${id}` : el.$type;
  }
}

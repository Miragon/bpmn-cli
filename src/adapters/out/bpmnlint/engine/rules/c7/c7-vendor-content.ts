import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, describeElement, ERROR_TYPES, type ModdleElement, type ReportData } from '../CamundaRules.js';

import { didYouMean } from '../didYouMean.js';
import { sh, slotted } from '../shell.js';
import { C7Diagram } from './C7Diagram.js';
import { C7Host, CAMUNDA_URI, ZEEBE_URI, type HostExtension } from './C7Host.js';
import { CamundaDescriptor } from './CamundaDescriptor.js';
import { CamundaPlacement, type Misplacement } from './CamundaPlacement.js';

/** Attributes the engines read that the descriptor knows as child elements only. */
const EXTRA_ATTRIBUTES: Record<string, string[]> = { 'camunda:Field': ['expression'] };

/**
 * Reports vendor content the Camunda 7 engines ignore: Camunda 8 (zeebe) attributes and extension
 * elements, camunda attributes the descriptor does not know (a typo such as camunda:asignee) or on
 * an element (or side of an event) the engines do not read them on, camunda extension elements
 * where the engines do not read them, and id references of camunda elements that name no element
 * of the type they need.
 */
class C7VendorContent extends C7Rule {
  private readonly descriptor = CamundaDescriptor.get();

  protected visit(node: ModdleElement): boolean | void {
    if (!C7Host.visits(node)) return false;
    const host = new C7Host(node);
    const definitions = host.isDefinitions();
    const read = definitions ? [] : new CamundaPlacement(host).readExtensions();
    this.checkForeignAttributes(host);
    if (!definitions) this.checkForeignExtensions(host, read.map(({ index }) => index));
    this.checkUnknownAttributes(host);
    for (const extension of read) for (const { element, where, path, key } of host.treeAttributes(extension)) if (!key.includes(':')) this.checkUnknownTreeAttribute(host, extension, element, where, [...path, key], key);
    this.checkMisplacedAttributes(host);
    if (definitions) return;
    this.checkMisplacedExtensions(host);
    for (const extension of host.camundaExtensions()) this.checkDanglingReferences(host, extension);
  }

  private reportOn(host: C7Host, finding: string, message: string, data: ReportData): void {
    this.report(finding, host.target, message, { node: host.node, ...data });
  }

  private checkForeignAttributes(host: C7Host): void {
    for (const { key, local, uri } of host.foreignAttributes()) if (uri === ZEEBE_URI) this.reportOn(host, 'c7-foreign-content', `${host.describe()} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, { path: host.path(`zeebe:${local}`), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: `zeebe:${local}`, hint: `Remove it: ${host.unset(key) ?? 'edit the XML'}, and use the camunda attribute instead (\`bpmn kinds\` lists them).` });
  }

  private checkForeignExtensions(host: C7Host, read: number[]): void {
    for (const extension of host.extensions()) {
      const type = String(extension.value.$type);
      if (extension.uri === ZEEBE_URI) this.reportOn(host, 'c7-foreign-content', `${host.describe()} contains the Camunda 8 extension ${type}, which Camunda 7 ignores`, { path: host.extensionPath(extension.index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: extension.value, extensionElement: extension.value, hint: host.address ? `Remove it: \`bpmn ext remove <file> ${host.address.id} ${slotted(host.address.slot, type)}\`.` : 'Remove it from the XML.' });
      if (!read.includes(extension.index)) continue;
      for (const { element, where, path, key, local, uri } of host.treeAttributes(extension)) if (uri === ZEEBE_URI) this.reportOn(host, 'c7-foreign-content', `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, { path: [...path, `zeebe:${local}`], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: element, property: `zeebe:${local}`, hint: host.rebuild(extension) });
    }
  }

  /** A camunda attribute the descriptor does not know: rename it to the one it most likely means, else remove it. */
  private checkUnknownAttributes(host: C7Host): void {
    for (const { key, local, uri } of host.foreignAttributes()) {
      if (uri !== CAMUNDA_URI || this.descriptor.ownersOf(local)) continue;
      const prefix = key.slice(0, key.indexOf(':'));
      const applicable = this.descriptor.attributeNamesFor(host.node);
      const guess = didYouMean(local, this.descriptor.attributeNames(), applicable);
      const fits = guess !== undefined && applicable.includes(guess);
      const suggestion = guess ? ` (did you mean ${prefix}:${guess}?${fits ? '' : ` It applies to ${CamundaDescriptor.kinds(this.descriptor.ownersOf(guess) ?? [])} only.`})` : '';
      const unset = host.address && `bpmn set <file> ${host.address.id} ${sh(`${host.address.slot}${key}=`)}`;
      const rename = fits ? ` ${sh(`${host.address?.slot}${prefix}:${guess}=${String(host.node.$attrs[key] ?? '')}`)}` : '';
      const hint = unset ? `${rename ? 'Rename' : 'Remove'} it: \`${unset}${rename}\`.` : 'Remove it: edit the XML.';
      this.reportOn(host, 'c7-unknown-attribute', `${host.describe()} has the unknown attribute ${key}${suggestion}; the engines ignore it`, { path: host.path(`camunda:${local}`), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: `camunda:${local}`, hint });
    }
  }

  private checkUnknownTreeAttribute(host: C7Host, extension: HostExtension, element: ModdleElement, where: string, path: (string | number)[], key: string): void {
    const names: string[] = (element.$descriptor?.properties ?? []).filter((property: { isAttr?: boolean; isReference?: boolean; isMany?: boolean }) => property.isAttr || (property.isReference && !property.isMany)).map((property: { name: string; ns?: { localName?: string } }) => property.ns?.localName ?? property.name);
    const guess = didYouMean(key, [...new Set([...names, ...(EXTRA_ATTRIBUTES[element.$type] ?? [])])]);
    this.reportOn(host, 'c7-unknown-attribute', `${where} has the unknown attribute ${key}${guess ? ` (did you mean ${guess}?)` : ''}; the engines ignore it`, { path, type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: element, property: key, hint: host.rebuild(extension) });
  }

  /** A camunda attribute on an element type it does not apply to, or on the side of an event that ignores it. */
  private checkMisplacedAttributes(host: C7Host): void {
    const remove = (key: string, withoutAddress: string) => (host.unset(key) ? `Remove it: ${host.unset(key)}.` : withoutAddress);
    const report = (key: string, local: string, readOn: string, hint: string) => this.reportOn(host, 'c7-misplaced-attribute', `${key} on ${host.describe()} has no effect: the engines read it on ${readOn} only`, { path: host.path(`camunda:${local}`), type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: `camunda:${local}`, hint });
    for (const { key, local, uri } of host.foreignAttributes()) {
      const owners = uri === CAMUNDA_URI ? this.descriptor.ownersOf(local) : undefined;
      if (owners && !this.descriptor.appliesTo(local, host.node)) report(key, local, CamundaDescriptor.kinds(owners), this.moveHint(host, key, `${local}=${String(host.node.$attrs[key] ?? '')}`, owners) ?? remove(key, 'Remove it from the XML.'));
    }
    const placement = new CamundaPlacement(host);
    for (const local of CamundaPlacement.sideAttributes()) {
      const side = placement.wrongSide(local, 'attributes');
      const property = host.node.$descriptor?.propertiesByName?.[`camunda:${local}`];
      if (side && property && Object.prototype.hasOwnProperty.call(host.node, property.name)) report(host.typeName(local), local, side, remove(host.typeName(local), 'Remove it: edit the XML.'));
    }
  }

  /** Where the attribute belongs on the element itself: the event definition of an event, the multi-instance loop of an activity, the condition of a flow; undefined when it belongs nowhere on it. `assignment` is `<local>=<value>`. */
  private moveHint(host: C7Host, key: string, assignment: string, owners: string[]): string | undefined {
    const { node, address } = host;
    if (!address || address.slot !== '') return undefined;
    const move = (slot: string) => `\`bpmn set <file> ${address.id} ${sh(`${key}=`)} ${sh(`${slot}${host.prefix}:${assignment}`)}\``;
    const definitions: ModdleElement[] = node.eventDefinitions ?? [];
    const fit = definitions.findIndex((definition) => owners.some((owner) => is(definition, owner)));
    if (is(node, 'bpmn:Event') && fit !== -1) return `It belongs on the event definition: ${move(definitions.length > 1 ? `definition[${fit}].` : 'definition.')}.`;
    if (is(node, 'bpmn:Activity') && owners.includes('bpmn:MultiInstanceLoopCharacteristics')) return `It belongs on the multi-instance loop: ${move('loop.')}${node.loopCharacteristics && is(node.loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics') ? '' : ' (creates a parallel multi-instance loop)'}.`;
    if (is(node, 'bpmn:SequenceFlow') && owners.includes('bpmn:FormalExpression') && node.conditionExpression) return `It belongs on the condition: ${move('condition.')}.`;
    return undefined;
  }

  /** A camunda extension element on a host type that ignores it, loose instead of inside its container, or on the side of an event that ignores it. */
  private checkMisplacedExtensions(host: C7Host): void {
    const placement = new CamundaPlacement(host);
    for (const extension of host.camundaExtensions()) {
      const misplacement = placement.misplacementOf(extension);
      if (misplacement) this.reportOn(host, 'c7-misplaced-extension', misplacement.message, { path: host.extensionPath(extension.index), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: extension.value, extensionElement: extension.value, hint: this.misplacedHint(host, extension, misplacement) });
    }
  }

  /** Remove it; a loose element is added again into its container, one the flow node reads is moved there. */
  private misplacedHint(host: C7Host, extension: HostExtension, { kind }: Misplacement): string {
    const address = host.address;
    if (kind === 'side') return host.removeBySelector(extension) ? `Remove it: ${host.removeBySelector(extension)}.` : 'Remove it from the XML.';
    if (!address) return kind === 'loose' ? 'Fix it in the XML.' : 'Remove it from the XML.';
    const type = host.typeName(extension.local);
    const again = C7Host.extAddArguments(extension.value, type);
    if (kind === 'loose') return `Remove it (${host.removeAt(extension)}) and add it again, \`bpmn ext add\` files it into its container: ${again ? `\`bpmn ext add <file> ${address.id} ${slotted(address.slot, again)}\`` : `\`bpmn ext add <file> ${address.id} ${slotted(address.slot, type)} --xml '...'\``}.`;
    const owner = host.owner;
    const moves = owner?.id && again && this.descriptor.isReadOn(extension.local, owner) && !new C7Host(owner).camundaExtensions(extension.local).length;
    return `Remove it: ${host.removeAt(extension)}${moves ? `, then add it to ${describeElement(owner)}, where the engines read it: \`bpmn ext add <file> ${owner.id} ${again}\`` : ''}.`;
  }

  /** An id reference of a camunda element (the errorRef of camunda:errorEventDefinition) that names no element of the type it needs: the engines ignore the mapping. */
  private checkDanglingReferences(host: C7Host, extension: HostExtension): void {
    const element = extension.value;
    for (const property of element.$descriptor?.properties ?? []) {
      if (!property.isReference || !property.isAttr || property.isMany) continue;
      const name: string = property.ns?.localName ?? property.name;
      const referenced = element.get(property.name);
      const unresolved = C7Diagram.unresolved(element).get(name);
      if (referenced ? referenced.$instanceOf(property.type) : unresolved === undefined) continue;
      const id = referenced ? referenced.id : unresolved;
      const typeName = property.type.replace(/^bpmn:/, '');
      let definitions = host.node;
      while (definitions && !is(definitions, 'bpmn:Definitions')) definitions = definitions.$parent;
      const candidates = (definitions?.rootElements ?? []).filter((root: ModdleElement) => is(root, property.type)).map((root: ModdleElement) => root.id ?? '').slice(0, 5);
      this.reportOn(host, 'c7-dangling-reference', `${host.typeName(extension.local)} of ${host.describe()} references ${name}="${id}", which is not a ${property.type} in the file; the engines ignore the mapping when it runs`, { path: host.extensionPath(extension.index, name), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: name, hint: `Point it at an existing one${candidates.length ? ` (${candidates.join(', ')})` : ''}. ${host.rebuild(extension, { [name]: `<${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}Id>` })}` });
    }
  }
}

export default defineRule(
  {
    ruleName: 'c7-vendor-content',
    kind: 'engine-specific',
    targetEngine: 'c7',
    findings: {
      'c7-foreign-content': ['W_C7_FOREIGN_CONTENT', 'runtime'],
      'c7-unknown-attribute': ['W_C7_UNKNOWN_ATTRIBUTE', 'runtime'],
      'c7-misplaced-attribute': ['W_C7_MISPLACED_ATTRIBUTE', 'runtime'],
      'c7-misplaced-extension': ['W_C7_MISPLACED_EXTENSION', 'runtime'],
      'c7-dangling-reference': ['W_C7_DANGLING_REF', 'runtime'],
    },
  },
  C7VendorContent,
);

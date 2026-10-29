import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement, type ReportData } from '../CamundaRules.js';

import { ElementKinds } from '../ElementKinds.js';
import { CAMUNDA_URI, DiagramNamespaces, ZEEBE_URI } from '../DiagramNamespaces.js';
import { DidYouMean } from '../DidYouMean.js';
import { RuleKit } from '../RuleKit.js';
import { Shell } from '../Shell.js';
import type { VendorHost } from '../VendorHost.js';
import { C7Diagram } from './C7Diagram.js';
import { C7Host, type HostExtension } from './C7Host.js';
import { CamundaPlacement, type Misplacement } from './CamundaPlacement.js';

/** Attributes the engines read that the descriptor knows as child elements only. */
const EXTRA_ATTRIBUTES: Record<string, string[]> = { 'camunda:Field': ['expression'] };

/**
 * Vendor content Camunda 7 does not read: Camunda 8 settings, and misspelled or misplaced camunda
 * settings.
 * Camunda 7 deploys the file and silently ignores the setting, so the process runs without the
 * behaviour the model seems to configure.
 *
 * - `c7-foreign-content`: zeebe attributes and extension elements.
 * - `c7-unknown-attribute`: a camunda attribute that does not exist, on a BPMN element or inside a
 *   camunda extension element.
 * - `c7-misplaced-attribute`: a camunda attribute on an element, or a side of an event, that does
 *   not read it.
 * - `c7-misplaced-extension`: a camunda extension element on an element, or a side of an event,
 *   that does not read it, or outside its container.
 * - `c7-dangling-reference`: an id reference of a camunda extension element (the errorRef of
 *   camunda:errorEventDefinition) that names no element of the needed type.
 *
 * @example a typo in an attribute name
 * <bpmn:userTask id="Review" camunda:asignee="demo" />  <!-- nobody gets assigned -->
 */
class C7VendorContent extends C7Rule {
  private readonly camunda = RuleKit.kit.CAMUNDA;

  protected visit(node: ModdleElement): boolean | void {
    if (!C7Host.visits(node)) return false;
    const host = new C7Host(node);
    const definitions = host.isDefinitions();
    const read = definitions ? [] : new CamundaPlacement(host).readExtensions();
    this.checkForeignAttributes(host);
    if (!definitions) this.checkForeignExtensions(host, read.map(({ index }) => index));
    this.checkUnknownAttributes(host);
    for (const extension of read) for (const { element, where, path, key } of host.treeAttributes(extension)) if (!key.includes(':')) this.reportUnknownAttribute(host, where, key, { property: key, path: [...path, key], node: element, hint: host.rebuild(extension) }, DidYouMean.suggestion(key, this.attributeNamesOf(element)));
    this.checkMisplacedAttributes(host);
    if (definitions) return;
    this.checkMisplacedExtensions(host);
    for (const extension of host.camundaExtensions()) this.checkDanglingReferences(host, extension);
  }

  private checkForeignAttributes(host: C7Host): void {
    for (const { key, local, uri } of host.foreignAttributes()) if (uri === ZEEBE_URI) this.reportForeignAttribute(host, host.describe(), key, { property: `zeebe:${local}`, path: host.path(`zeebe:${local}`), hint: `Remove it: ${host.unset(key) ?? 'edit the XML'}, and use the camunda attribute instead (\`bpmn kinds\` lists them).` });
  }

  private checkForeignExtensions(host: C7Host, read: number[]): void {
    for (const extension of host.extensions()) {
      const type = String(extension.value.$type);
      if (extension.uri === ZEEBE_URI) this.reportContent(host, 'c7-foreign-content', `${host.describe()} contains the Camunda 8 extension ${type}, which Camunda 7 ignores`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: extension.value, path: host.extensionPath(extension.index), node: extension.value, hint: host.address ? `Remove it: ${host.address.extRemove(type)}.` : 'Remove it from the XML.' });
      if (!read.includes(extension.index)) continue;
      for (const { element, where, path, key, local, uri } of host.treeAttributes(extension)) if (uri === ZEEBE_URI) this.reportForeignAttribute(host, where, key, { property: `zeebe:${local}`, path: [...path, `zeebe:${local}`], node: element, hint: host.rebuild(extension) });
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

  /** A camunda attribute on an element type it does not apply to, or on the side of an event that ignores it. */
  private checkMisplacedAttributes(host: C7Host): void {
    const remove = (key: string, withoutAddress: string) => (host.unset(key) ? `Remove it: ${host.unset(key)}.` : withoutAddress);
    const report = (key: string, local: string, readOn: string, hint: string) => this.reportContent(host, 'c7-misplaced-attribute', `${key} on ${host.describe()} has no effect: the engines read it on ${readOn} only`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: `camunda:${local}`, path: host.path(`camunda:${local}`), hint });
    for (const { key, local, uri } of host.foreignAttributes()) {
      const owners = uri === CAMUNDA_URI ? this.camunda.attr(local)?.owners : undefined;
      if (owners && !owners.some((owner) => host.node.$instanceOf(owner))) report(key, local, ElementKinds.list(owners, 4), this.moveHint(host, key, `${local}=${String(host.node.$attrs[key] ?? '')}`, owners) ?? remove(key, 'Remove it from the XML.'));
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
    const move = (slot: string) => `\`bpmn set <file> ${address.id} ${Shell.quote(`${key}=`)} ${Shell.quote(`${slot}${host.prefix}:${assignment}`)}\``;
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
      if (!misplacement) continue;
      const type = host.typeName(extension.local);
      const message = misplacement.kind === 'loose' ? `${type} sits directly in the extension elements of ${host.describe()}, but belongs inside ${misplacement.containers}; the engines ignore it` : `${type} on ${host.describe()} has no effect: the engines read it on ${misplacement.readOn} only`;
      this.reportContent(host, 'c7-misplaced-extension', message, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: extension.value, path: host.extensionPath(extension.index), node: extension.value, hint: this.misplacedHint(host, extension, misplacement) });
    }
  }

  /** Remove it; a loose element is added again into its container, one the flow node reads is moved there. */
  private misplacedHint(host: C7Host, extension: HostExtension, { kind }: Misplacement): string {
    const address = host.address;
    if (kind === 'side') return host.address ? `Remove it: ${host.address.extRemove(host.selector(extension))}.` : 'Remove it from the XML.';
    if (!address) return kind === 'loose' ? 'Fix it in the XML.' : 'Remove it from the XML.';
    const type = host.typeName(extension.local);
    const again = C7Host.extAddArguments(extension.value, type);
    if (kind === 'loose') return `Remove it (${address.extRemove(extension.index)}) and add it again, \`bpmn ext add\` files it into its container: ${address.extAdd(again ?? `${type} --xml '...'`)}.`;
    const owner = host.owner;
    const moves = owner?.id && again && CamundaPlacement.isReadOn(extension.local, owner) && !new C7Host(owner).camundaExtensions(extension.local).length;
    return `Remove it: ${address.extRemove(extension.index)}${moves ? `, then add it to ${ElementKinds.describe(owner)}, where the engines read it: \`bpmn ext add <file> ${owner.id} ${again}\`` : ''}.`;
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
      const candidates = (DiagramNamespaces.definitionsOf(host.node)?.rootElements ?? []).filter((root: ModdleElement) => is(root, property.type)).map((root: ModdleElement) => root.id ?? '').slice(0, 5);
      this.reportContent(host, 'c7-dangling-reference', `${host.typeName(extension.local)} of ${host.describe()} references ${name}="${id}", which is not a ${property.type} in the file; the engines ignore the mapping when it runs`, { path: host.extensionPath(extension.index, name), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: element, property: name, hint: `Point it at an existing one${candidates.length ? ` (${candidates.join(', ')})` : ''}. ${host.rebuild(extension, { [name]: `<${ElementKinds.xmlName(typeName)}Id>` })}` });
    }
  }

  private reportForeignAttribute(host: VendorHost, where: string, key: string, data: Pick<ReportData, 'path'> & Record<string, unknown>): void {
    this.reportContent(host, 'c7-foreign-content', `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }

  /** `name` on `where`, which the descriptor does not know; `suggestion` names the one it most likely means. */
  private reportUnknownAttribute(host: VendorHost, where: string, name: string, data: Pick<ReportData, 'path'> & Record<string, unknown>, suggestion: string): void {
    this.reportContent(host, 'c7-unknown-attribute', `${where} has the unknown attribute ${name}${suggestion}; the engines ignore it`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }

  private reportContent(host: VendorHost, finding: string, message: string, { path, ...data }: ReportData): void {
    this.report(finding, host.target, message, { node: host.node, path, ...data });
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

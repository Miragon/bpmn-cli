import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { CAMUNDA_URI, DiagramNamespaces } from '../DiagramNamespaces.js';
import { sh, slotted } from '../shell.js';
import { EngineScope } from '../EngineScope.js';
import { type ForeignAttribute, type TreeElement, VendorHost } from '../VendorHost.js';
import { C7Diagram } from './C7Diagram.js';

/** The camunda types the engines read as one element, which `bpmn ext add --replace` rebuilds as a whole. */
const SINGLE_TYPES = ['inputOutput', 'formData', 'connector', 'failedJobRetryTimeCycle', 'properties'];
/** Attributes that pick one item of a repeatable type, in the order a selector prefers them. */
const SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];

/** One entry of a host's extension elements: a typed camunda element, or a generic one of another namespace. */
export interface HostExtension {
  value: ModdleElement;
  index: number;
  /** `inputOutput`, `taskListener`, `taskDefinition` */
  local: string;
  uri: string | undefined;
  isCamunda: boolean;
}

/**
 * A BPMN element as the Camunda 7 checks of camunda content see it: whether they look at it at
 * all, its camunda content, and the `bpmn` commands of the hints that rebuild, remove or merge its
 * extension elements and unset its attributes, through the slot of the flow node.
 */
export class C7Host extends VendorHost {
  /** The prefix the file writes camunda content with. */
  readonly prefix: string;

  constructor(node: ModdleElement) {
    super(node);
    this.prefix = C7Diagram.of(node).prefix;
  }

  /**
   * Whether the checks look at `node`: BPMN elements outside vendor content and DI, except a
   * non-executable process and an ad-hoc sub-process of an executable one, with everything inside
   * them (the engines skip them).
   */
  static visits(node: ModdleElement): boolean {
    if (!String(node.$type).startsWith('bpmn:') || is(node, 'bpmn:ExtensionElements')) return false;
    if (is(node, 'bpmn:Process')) return node.isExecutable === true;
    return !(is(node, 'bpmn:AdHocSubProcess') && EngineScope.inExecutableProcess(node));
  }

  isDefinitions(): boolean {
    return is(this.node, 'bpmn:Definitions');
  }

  extensions(): HostExtension[] {
    const namespaces = DiagramNamespaces.forElement(this.node);
    return (this.node.extensionElements?.values ?? []).map((value: ModdleElement, index: number) => {
      const type = String(value.$type);
      const isCamunda = !value.$descriptor?.isGeneric && type.startsWith('camunda:');
      return { value, index, local: C7Host.lowerFirst(type.slice(type.indexOf(':') + 1)), uri: isCamunda ? CAMUNDA_URI : namespaces.uriOf(type), isCamunda };
    });
  }

  camundaExtensions(local?: string): HostExtension[] {
    return this.extensions().filter((extension) => extension.isCamunda && (local === undefined || extension.local === local));
  }

  /** The prefixed attributes the moddle left on the camunda elements of `extension`, depth first, each with its element. */
  treeAttributes(extension: HostExtension): Array<TreeElement & ForeignAttribute> {
    return this.tree(extension.value, this.prefix, this.extensionPath(extension.index)).flatMap((treeElement) => VendorHost.foreignAttributesOf(treeElement.element).map((attribute) => ({ ...treeElement, ...attribute })));
  }

  /** `camunda:inputOutput`, with the file's prefix. */
  typeName(local: string): string {
    return `${this.prefix}:${local}`;
  }

  /** `` `bpmn set <file> X camunda:asignee=` `` for the attribute `key` as the file spells it; undefined without an address. */
  unset(key: string): string | undefined {
    return this.address?.unset(key);
  }

  /**
   * How to rebuild one top-level extension element. A single-instance type is replaced as a whole
   * (`--replace`); a repeatable one is removed by its own selector and added again, as `--replace`
   * would remove its siblings. `fix` puts placeholders in for attributes.
   */
  rebuild(extension: HostExtension, fix: Record<string, string> = {}): string {
    if (!this.address) return 'Fix it in the XML.';
    const { id, slot } = this.address;
    const type = this.typeName(extension.local);
    if (SINGLE_TYPES.includes(extension.local)) return `See it with \`bpmn ext list <file> ${id} --json\`, then rebuild it: \`bpmn ext add <file> ${id} ${slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
    const flat = C7Host.extAddArguments(extension.value, type, fix);
    const again = flat ? `\`bpmn ext add <file> ${id} ${slotted(slot, flat)}\`` : `\`bpmn ext add <file> ${id} ${slotted(slot, type)} --xml '<${type} ...>...</${type}>'\` (\`bpmn ext list <file> ${id} --json\` shows it)`;
    return `Replace just this one (--replace would remove every ${type}): \`bpmn ext remove <file> ${id} ${sh(`${slot}${this.selector(extension)}`)}\`, then ${again}.`;
  }

  /** `Merge them into one: ...` for duplicates of a single-instance type. */
  merge(local: string): string {
    if (!this.address) return 'Merge them in the XML.';
    const type = this.typeName(local);
    return `Merge them into one: \`bpmn ext list <file> ${this.address.id} --json\`, then \`bpmn ext add <file> ${this.address.id} ${slotted(this.address.slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
  }

  /** `bpmn ext remove` of an extension element by its position. */
  removeAt(extension: HostExtension): string | undefined {
    return this.address && `\`bpmn ext remove <file> ${this.address.id} ${slotted(this.address.slot, String(extension.index))}\``;
  }

  /** `bpmn ext remove` of an extension element by its selector (`camunda:field[name=a]`). */
  removeBySelector(extension: HostExtension): string | undefined {
    return this.address && `\`bpmn ext remove <file> ${this.address.id} ${sh(`${this.address.slot}${this.selector(extension)}`)}\``;
  }

  /** `ext remove` selector of a top-level extension element: a unique attribute, else its index among its type. */
  selector(extension: HostExtension): string {
    const type = this.typeName(extension.local);
    const siblings = this.extensions().filter((sibling) => sibling.value.$type === extension.value.$type).map((sibling) => sibling.value);
    for (const key of SELECTOR_KEYS) {
      const value = C7Host.attributeValue(extension.value, key);
      if (value !== undefined && value !== '' && siblings.filter((sibling) => C7Host.attributeValue(sibling, key) === value).length === 1) return `${type}[${key}=${/^[\w.:-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`}]`;
    }
    return `${type}[${Math.max(0, siblings.indexOf(extension.value))}]`;
  }

  /** `bpmn ext add` arguments that re-create a flat camunda element (attributes and body), or undefined when it has child elements; `fix` replaces attribute values (placeholders). */
  static extAddArguments(element: ModdleElement, type: string, fix: Record<string, string> = {}): string | undefined {
    const entries = C7Host.attributesOf(element);
    if (!entries) return undefined;
    for (const key of Object.keys(fix)) if (!entries.some(([existing]) => existing === key)) entries.push([key, fix[key] ?? '']);
    const bodyProperty = (element.$descriptor?.properties ?? []).find((property: { isBody?: boolean }) => property.isBody);
    const body = bodyProperty ? element[bodyProperty.name] : undefined;
    return [type, ...entries.map(([key, value]) => sh(`${key}=${fix[key] ?? value}`)), ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
  }

  /** The attributes of a typed camunda element in file order, an unresolved reference where the descriptor puts it; undefined with child elements. */
  private static attributesOf(element: ModdleElement): Array<[string, string]> | undefined {
    const properties: Array<{ name: string; isAttr?: boolean; isBody?: boolean }> = element.$descriptor?.properties ?? [];
    const entries: Array<[string, string]> = [];
    for (const key of Object.keys(element)) {
      const property = properties.find((candidate) => candidate.name === key);
      const value = element[key];
      if (key.startsWith('$') || property?.isBody || (Array.isArray(value) && value.length === 0)) continue;
      if (property && !property.isAttr) return undefined;
      entries.push([key, value && typeof value === 'object' ? String(value.id) : String(value)]);
    }
    const rank = (name: string) => properties.findIndex((property) => property.name === name);
    for (const [name, id] of C7Diagram.unresolved(element)) {
      const before = entries.findIndex(([key]) => rank(key) > rank(name));
      entries.splice(before === -1 ? entries.length : before, 0, [name, id]);
    }
    for (const [key, value] of Object.entries(element.$attrs ?? {})) if (!key.startsWith('xmlns')) entries.push([key, String(value)]);
    return entries;
  }

  /** An attribute as the file writes it: a typed property (a reference as the id it names, also one the parse could not resolve), else one the moddle left in `$attrs`. */
  private static attributeValue(element: ModdleElement, name: string): string | undefined {
    const value = Object.prototype.hasOwnProperty.call(element, name) ? element[name] : (element.$attrs?.[name] ?? C7Diagram.unresolved(element).get(name));
    if (value === undefined || value === null) return undefined;
    return typeof value === 'object' ? value.id : String(value);
  }

  private static lowerFirst(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }
}

import { is } from 'bpmnlint-utils';

import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from '../DiagramNamespaces.js';
import { describeElement } from '../describe.js';
import { SetCommand } from '../SetCommand.js';
import { sh, slotted } from '../shell.js';
import { C7Diagram } from './C7Diagram.js';

export const CAMUNDA_URI = 'http://camunda.org/schema/1.0/bpmn';
export const ZEEBE_URI = 'http://camunda.org/schema/zeebe/1.0';

/** The camunda types the engines read as one element, which `bpmn ext add --replace` rebuilds as a whole. */
const SINGLE_TYPES = ['inputOutput', 'formData', 'connector', 'failedJobRetryTimeCycle', 'properties'];
/** Attributes that pick one item of a repeatable type, in the order a selector prefers them. */
const SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];

/** A prefixed attribute the moddle left in `$attrs`, with the namespace its prefix stands for. */
export interface ForeignAttribute {
  key: string;
  local: string;
  uri: string | undefined;
}

/** One entry of a host's extension elements: a typed camunda element, or a generic one of another namespace. */
export interface HostExtension {
  value: ModdleElement;
  index: number;
  /** `inputOutput`, `taskListener`, `taskDefinition` */
  local: string;
  uri: string | undefined;
  isCamunda: boolean;
}

/** One camunda element inside an extension element (the extension element included), as messages name it. */
interface TreeElement {
  element: ModdleElement;
  /** `camunda:inputParameter (in camunda:connector > camunda:inputOutput) of serviceTask Activity_1` */
  where: string;
  /** The path from the host's reported element to this one. */
  path: ReportPath;
}

/**
 * A BPMN element as the Camunda 7 checks of camunda content see it: whether they look at it at
 * all, the element its findings land on (an event definition, loop or condition on its flow node
 * or flow, anything without an id on the nearest element with one), how messages name it, its
 * camunda content, and the `bpmn` commands of the hints that rebuild, remove or merge its
 * extension elements and unset its attributes, through the slot of the flow node.
 */
export class C7Host {
  /** The nearest enclosing element with an id, below `bpmn:Definitions`. */
  readonly owner: ModdleElement | undefined;
  /** The element a finding about this host is reported on. */
  readonly target: ModdleElement;
  /** The prefix the file writes camunda content with. */
  readonly prefix: string;
  /** How `bpmn set` and `bpmn ext` address this host, undefined without an id to address it by. */
  readonly address: SetCommand | undefined;
  private readonly pathPrefix: ReportPath;

  constructor(readonly node: ModdleElement) {
    this.owner = C7Host.nearestWithId(node.$parent);
    const slot = this.owner && this.owner !== node ? this.slotIn(this.owner) : '';
    this.target = slot || !node.id ? (this.owner ?? node) : node;
    this.pathPrefix = C7Host.pathBetween(this.target, node);
    this.prefix = C7Diagram.of(node).prefix;
    this.address = slot || node.id ? new SetCommand(this.target.id, slot) : undefined;
  }

  /**
   * Whether the checks look at `node`: BPMN elements outside vendor content and DI, except a
   * non-executable process and an ad-hoc sub-process of an executable one, with everything inside
   * them (the engines skip them).
   */
  static visits(node: ModdleElement): boolean {
    if (!String(node.$type).startsWith('bpmn:') || is(node, 'bpmn:ExtensionElements')) return false;
    if (is(node, 'bpmn:Process')) return node.isExecutable === true;
    return !(is(node, 'bpmn:AdHocSubProcess') && C7Host.isExecutable(node));
  }

  /** Whether `node` lies in a process with `isExecutable="true"`. */
  static isExecutable(node: ModdleElement): boolean {
    let current = node;
    while (current && !is(current, 'bpmn:Process')) current = current.$parent;
    return current?.isExecutable === true;
  }

  /** `serviceTask Activity_1`, `the multiInstanceLoopCharacteristics of userTask Activity_1` */
  describe(): string {
    return describeElement(this.node, this.owner);
  }

  isDefinitions(): boolean {
    return is(this.node, 'bpmn:Definitions');
  }

  /** The prefixed attributes the moddle did not type, in file order. */
  foreignAttributes(): ForeignAttribute[] {
    return C7Host.foreignAttributesOf(this.node).filter(({ key }) => key.includes(':'));
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

  /** The path from the reported element to a property of this host. */
  path(...steps: ReportPath): ReportPath {
    return [...this.pathPrefix, ...steps];
  }

  /** The path from the reported element to a property of the extension element at `index`. */
  extensionPath(index: number, ...steps: ReportPath): ReportPath {
    return this.path('extensionElements', 'values', index, ...steps);
  }

  /** The prefixed attributes the moddle left on the camunda elements of `extension`, depth first, each with its element. */
  treeAttributes(extension: HostExtension): Array<TreeElement & ForeignAttribute> {
    const found: TreeElement[] = [];
    this.collect(extension.value, '', this.extensionPath(extension.index), found);
    return found.flatMap((treeElement) => C7Host.foreignAttributesOf(treeElement.element).map((attribute) => ({ ...treeElement, ...attribute })));
  }

  /** `camunda:inputOutput`, with the file's prefix. */
  typeName(local: string): string {
    return `${this.prefix}:${local}`;
  }

  /** `` `bpmn set <file> X camunda:asignee=` `` for the attribute `key` as the file spells it; undefined without an address. */
  unset(key: string): string | undefined {
    return this.address && `\`bpmn set <file> ${this.address.id} ${sh(`${this.address.slot}${key}=`)}\``;
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

  /** The attributes of any element the moddle did not type, with their namespace when prefixed. */
  private static foreignAttributesOf(el: ModdleElement): ForeignAttribute[] {
    const namespaces = DiagramNamespaces.forElement(el);
    return Object.keys(el.$attrs ?? {}).filter((key) => !key.startsWith('xmlns')).map((key) => ({ key, local: key.slice(key.indexOf(':') + 1), uri: namespaces.uriOf(key) }));
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

  private collect(element: ModdleElement, trail: string, path: ReportPath, found: TreeElement[]): void {
    const name = `${this.prefix}:${C7Host.lowerFirst(String(element.$type).replace(/^camunda:/, ''))}`;
    found.push({ element, where: `${name}${trail ? ` (in ${trail})` : ''} of ${this.describe()}`, path });
    for (const property of element.$descriptor?.properties ?? []) {
      if (property.isAttr || property.isReference || !String(property.type).startsWith('camunda:')) continue;
      const propertyName = property.ns?.localName ?? property.name;
      const value = element.get(property.name);
      const children: ModdleElement[] = (Array.isArray(value) ? value : [value]).filter(Boolean);
      children.forEach((child, index) => this.collect(child, trail ? `${trail} > ${name}` : name, Array.isArray(value) ? [...path, propertyName, index] : [...path, propertyName], found));
    }
  }

  /** The path from `ancestor` down to `el` through the properties that contain each step. */
  private static pathBetween(ancestor: ModdleElement, el: ModdleElement): ReportPath {
    const steps: ReportPath = [];
    for (let child = el; child && child !== ancestor && child.$parent; child = child.$parent) steps.unshift(...C7Host.stepInto(child.$parent, child));
    return steps;
  }

  private static stepInto(parent: ModdleElement, child: ModdleElement): ReportPath {
    for (const property of parent.$descriptor?.properties ?? []) {
      const value = parent.get(property.name);
      if (value === child) return [property.ns?.localName ?? property.name];
      if (Array.isArray(value) && value.includes(child)) return [property.ns?.localName ?? property.name, value.indexOf(child)];
    }
    return [];
  }

  private static nearestWithId(start: ModdleElement): ModdleElement | undefined {
    for (let current = start; current && !is(current, 'bpmn:Definitions'); current = current.$parent) if (current.id) return current;
    return undefined;
  }

  private static lowerFirst(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  /** The slot of the host in `owner` when it is an event definition, loop or condition of it, else ''. */
  private slotIn(owner: ModdleElement): string {
    const definitions: ModdleElement[] = owner.eventDefinitions ?? [];
    if (definitions.includes(this.node)) return definitions.length > 1 ? `definition[${definitions.indexOf(this.node)}].` : 'definition.';
    if (owner.loopCharacteristics === this.node) return 'loop.';
    return owner.conditionExpression === this.node ? 'condition.' : '';
  }
}

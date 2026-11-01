import { type BpmnDocument, BpmnElement, BpmnError, CamundaDescriptor, DeclaredNamespaces, ZeebeDescriptor } from '../../model/index.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import type { NestedHosts } from './NestedHosts.js';

export class VendorElements {
  private static readonly NAME_RE = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/;
  private static readonly CANONICAL_PREFIX: Readonly<Record<string, string>> = { [CamundaDescriptor.URI]: 'camunda', [CamundaDescriptor.OPERATON_URI]: 'operaton', [ZeebeDescriptor.URI]: 'zeebe', [DeclaredNamespaces.BPMN]: 'bpmn' };
  private static readonly CANONICAL_URI: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(VendorElements.CANONICAL_PREFIX).map(([uri, prefix]) => [prefix, uri]));

  constructor(
    private readonly document: BpmnDocument,
    private readonly hosts: NestedHosts,
  ) {}

  typeOf(el: BpmnElement): string {
    const ns = (el.descriptor as { ns?: { prefix?: string; localName?: string; uri?: string } } | undefined)?.ns;
    const [prefix, local] = el.type.includes(':') ? (el.type.split(':') as [string, string]) : ['', el.type];
    const uri = ns?.uri ?? (prefix === 'bpmn' ? DeclaredNamespaces.BPMN : this.document.namespaces.uriOf(prefix));
    return this.canonicalType(uri, ns?.localName ?? local, el.type);
  }

  canonicalName(name: string, scope: Record<string, string> = {}): string {
    const match = VendorElements.NAME_RE.exec(name.trim());
    if (!match) {
      return name.trim();
    }
    const uri = scope[match[1]!] ?? (match[1] === 'bpmn' ? DeclaredNamespaces.BPMN : this.document.namespaces.uriOf(match[1]!));
    return this.canonicalType(uri, match[2]!, name.trim());
  }

  canonicalUri(prefix: string): string | undefined {
    return VendorElements.CANONICAL_URI[prefix];
  }

  resolvePrefix(el: BpmnElement, prefix: string, scope: Record<string, string>): { prefix: string; uri: string } {
    const document = this.document;
    const inline = scope[prefix];
    if (inline === DeclaredNamespaces.BPMN || (inline === undefined && prefix === 'bpmn')) {
      return { prefix: this.bpmnPrefix(), uri: DeclaredNamespaces.BPMN };
    }
    const uri = inline ?? document.namespaces.uriOf(prefix);
    if (!uri) {
      document.namespaces.declare(prefix);
      return { prefix, uri: document.namespaces.uriOf(prefix)! };
    }
    const existing = this.filePrefixFor(uri);
    if (existing) {
      return { prefix: existing, uri };
    }
    const bound = (document.tree.definitions.attrs as Record<string, unknown>)[`xmlns:${prefix}`];
    if (typeof bound === 'string' && bound !== uri) {
      throw BpmnError.model('E_INVALID_XML', `The prefix "${prefix}" is bound to ${bound} in the file, the snippet binds it to ${uri}`, {
        element: this.hosts.idOf(el),
        hint: `Use another prefix for ${uri} in the snippet.`,
      });
    }
    document.namespaces.declare(prefix, uri);
    return { prefix, uri };
  }

  createGeneric(el: BpmnElement, name: string, attrs: Record<string, string>, body: string | undefined, scope: Record<string, string>, nested: boolean): BpmnElement {
    const { prefix, local } = this.splitName(name, el);
    const ns = this.resolvePrefix(el, prefix, scope);
    if (ns.uri === DeclaredNamespaces.BPMN && !nested) {
      this.refuseBpmnAtTop(name, prefix, el);
    }
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
      const match = VendorElements.NAME_RE.exec(key);
      if (!match || match[1] === 'xmlns') {
        props[key] = value;
        continue;
      }
      const resolved = this.resolvePrefix(el, match[1]!, scope);
      props[`${resolved.prefix}:${match[2]}`] = match[1] === 'xsi' && match[2] === 'type' ? this.qnameValue(value, scope) : value;
    }
    if (body !== undefined && body !== '') {
      props['$body'] = body;
    }
    return this.document.tree.buildAny(`${ns.prefix}:${local}`, ns.uri, props);
  }

  kidsOf(el: BpmnElement): BpmnElement[] {
    return el.list<unknown>('$children').filter((kid): kid is BpmnElement => kid instanceof BpmnElement);
  }

  attrsOf(el: BpmnElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [rawKey, rawValue] of el.ownEntries()) {
      if (rawKey.startsWith('$') || rawValue === undefined || rawValue === null || typeof rawValue === 'object' || typeof rawValue === 'function') {
        continue;
      }
      out[rawKey] = String(rawValue);
    }
    return out;
  }

  bodyOf(el: BpmnElement): string | undefined {
    const body = el.peek('$body');
    return typeof body === 'string' && body.trim() ? body : undefined;
  }

  isGeneric(el: BpmnElement): boolean {
    return !!el.descriptor.isGeneric;
  }

  keyOf(el: BpmnElement): { attr: string; value: string } | undefined {
    const attrs = this.attrsOf(el);
    for (const attrKey of ExtensionStructure.INSTANCE.keysOf(this.typeOf(el))) {
      if (attrs[attrKey] !== undefined) {
        return { attr: attrKey, value: attrs[attrKey]! };
      }
    }
    return undefined;
  }

  itemLabel(el: BpmnElement): string {
    const key = this.keyOf(el);
    return key ? `${el.type}[${key.attr}=${key.value}]` : el.type;
  }

  pathOf(el: BpmnElement): string {
    const steps: string[] = [];
    for (let cur: BpmnElement | undefined = el; cur && !cur.is('bpmn:ExtensionElements'); cur = cur.parent) {
      steps.unshift(this.stepOf(cur));
    }
    return steps.join('/');
  }

  private stepOf(el: BpmnElement): string {
    if (this.keyOf(el)) {
      return this.itemLabel(el);
    }
    const same = this.siblingsOf(el).filter((sibling) => sibling.type === el.type);
    return same.length > 1 ? `${el.type}[${same.indexOf(el)}]` : el.type;
  }

  private siblingsOf(el: BpmnElement): readonly BpmnElement[] {
    const { parent } = el;
    if (!parent) {
      return [el];
    }
    return parent.is('bpmn:ExtensionElements') ? parent.list('values') : this.kidsOf(parent);
  }

  private canonicalType(uri: string | undefined, local: string, fallback: string): string {
    const canonicalPrefix = uri ? VendorElements.CANONICAL_PREFIX[uri] : undefined;
    if (canonicalPrefix) {
      return `${canonicalPrefix}:${local}`;
    }
    return uri ? `{${uri}}${local}` : fallback;
  }

  private filePrefixFor(uri: string): string | undefined {
    for (const [attrName, attrValue] of Object.entries(this.document.tree.definitions.attrs as Record<string, unknown>)) {
      if (attrName.startsWith('xmlns:') && attrValue === uri) {
        return attrName.slice(6);
      }
    }
    return undefined;
  }

  private bpmnPrefix(): string {
    return this.filePrefixFor(DeclaredNamespaces.BPMN) ?? 'bpmn';
  }

  private splitName(name: string, el: BpmnElement): { prefix: string; local: string } {
    const match = VendorElements.NAME_RE.exec(name.trim());
    if (!match) {
      throw BpmnError.model('E_INVALID_VALUE', `"${name}" is not a prefixed element name (expected prefix:localName, e.g. zeebe:taskDefinition)`, { element: this.hosts.idOf(el) });
    }
    if (match[1] === 'xmlns') {
      throw BpmnError.model('E_INVALID_VALUE', `"${name}" is not an element name`, { element: this.hosts.idOf(el) });
    }
    return { prefix: match[1]!, local: match[2]! };
  }

  private refuseBpmnAtTop(type: string, prefix: string, el: BpmnElement): never {
    throw BpmnError.model('E_INVALID_VALUE', `Extension elements must belong to a vendor namespace, not "${prefix}:" (${type} at the top level of extensionElements)`, {
      element: this.hosts.idOf(el),
      hint: 'Use a vendor prefix such as zeebe: or camunda:. bpmn: elements are accepted inside a vendor element (a timeout camunda:taskListener with bpmn:timerEventDefinition, camunda:potentialStarter with bpmn:resourceAssignmentExpression).',
    });
  }

  private qnameValue(value: string, scope: Record<string, string>): string {
    const match = VendorElements.NAME_RE.exec(value.trim());
    if (!match) {
      return value;
    }
    const uri = scope[match[1]!] ?? (match[1] === 'bpmn' ? DeclaredNamespaces.BPMN : undefined);
    if (uri !== DeclaredNamespaces.BPMN) {
      return value;
    }
    const attrs = this.document.tree.definitions.attrs as Record<string, unknown>;
    if (!this.filePrefixFor(DeclaredNamespaces.BPMN) && attrs['xmlns'] === DeclaredNamespaces.BPMN) {
      return match[2]!;
    }
    return `${this.bpmnPrefix()}:${match[2]}`;
  }
}

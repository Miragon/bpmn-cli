import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { BPMN_NS, is, many, type El } from '../model/utils/moddle.js';
import { descriptorOf, isEl } from './utils/elements.js';
import { EXTENSION_STRUCTURE } from './ExtensionStructure.js';
import type { NestedHosts } from './NestedHosts.js';
import { CAMUNDA_URI, OPERATON_URI } from '../platform/CamundaDescriptor.js';
import { ZEEBE_URI } from '../platform/ZeebeDescriptor.js';

const NAME_RE = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/;

const CANONICAL_PREFIX: Readonly<Record<string, string>> = { [CAMUNDA_URI]: 'camunda', [OPERATON_URI]: 'operaton', [ZEEBE_URI]: 'zeebe', [BPMN_NS]: 'bpmn' };
const CANONICAL_URI: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(CANONICAL_PREFIX).map(([uri, prefix]) => [prefix, uri]));

type Raw = Record<string, unknown>;

/** Names, prefixes and creation of vendor extension elements (camunda:, zeebe:, ...). */
export class VendorElements {
  constructor(
    private readonly doc: Doc,
    private readonly hosts: NestedHosts,
  ) {}

  /** The prefix comes from the namespace URI, not from what the file declares. */
  typeOf(el: El): string {
    const ns = (el.$descriptor as { ns?: { prefix?: string; localName?: string; uri?: string } } | undefined)?.ns;
    const [prefix, local] = el.$type.includes(':') ? (el.$type.split(':') as [string, string]) : ['', el.$type];
    const uri = ns?.uri ?? (prefix === 'bpmn' ? BPMN_NS : this.doc.namespaceUri(prefix));
    return this.canonical(uri, ns?.localName ?? local, el.$type);
  }

  canonicalName(name: string, scope: Record<string, string> = {}): string {
    const m = NAME_RE.exec(name.trim());
    if (!m) return name.trim();
    const uri = scope[m[1]!] ?? (m[1] === 'bpmn' ? BPMN_NS : this.doc.namespaceUri(m[1]!));
    return this.canonical(uri, m[2]!, name.trim());
  }

  canonicalUri(prefix: string): string | undefined {
    return CANONICAL_URI[prefix];
  }

  /** A URI the file already binds keeps the file's prefix; a new one is declared on definitions. */
  resolvePrefix(el: El, prefix: string, scope: Record<string, string>): { prefix: string; uri: string } {
    const doc = this.doc;
    const inline = scope[prefix];
    if (inline === BPMN_NS || (inline === undefined && prefix === 'bpmn')) return { prefix: this.bpmnPrefix(), uri: BPMN_NS };
    const uri = inline ?? doc.namespaceUri(prefix);
    if (!uri) {
      doc.declareNamespace(prefix); // throws E_UNKNOWN_NAMESPACE with the standard hint
      return { prefix, uri: doc.namespaceUri(prefix)! };
    }
    const existing = this.filePrefixFor(uri);
    if (existing) return { prefix: existing, uri };
    const bound = (doc.definitions.$attrs as Record<string, unknown>)[`xmlns:${prefix}`];
    if (typeof bound === 'string' && bound !== uri) {
      throw modelError('E_INVALID_XML', `The prefix "${prefix}" is bound to ${bound} in the file, the snippet binds it to ${uri}`, {
        element: this.hosts.idOf(el),
        hint: `Use another prefix for ${uri} in the snippet.`,
      });
    }
    doc.declareNamespace(prefix, uri);
    return { prefix, uri };
  }

  createGeneric(el: El, name: string, attrs: Record<string, string>, body: string | undefined, scope: Record<string, string>, nested: boolean): El {
    const { prefix, local } = this.splitName(name, el);
    const ns = this.resolvePrefix(el, prefix, scope);
    if (ns.uri === BPMN_NS && !nested) this.refuseBpmnAtTop(name, prefix, el);
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
      const m = NAME_RE.exec(key);
      if (!m || m[1] === 'xmlns') {
        props[key] = value;
        continue;
      }
      const a = this.resolvePrefix(el, m[1]!, scope);
      props[`${a.prefix}:${m[2]}`] = m[1] === 'xsi' && m[2] === 'type' ? this.qnameValue(value, scope) : value;
    }
    if (body !== undefined && body !== '') props['$body'] = body;
    return this.doc.moddle.createAny(`${ns.prefix}:${local}`, ns.uri, props) as unknown as El;
  }

  kidsOf(el: El): El[] {
    const kids = (el as unknown as Raw)['$children'];
    return Array.isArray(kids) ? kids.filter(isEl) : [];
  }

  attrsOf(el: El): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(el as unknown as Raw)) {
      if (k.startsWith('$') || v === undefined || v === null || typeof v === 'object' || typeof v === 'function') continue;
      out[k] = String(v);
    }
    return out;
  }

  bodyOf(el: El): string | undefined {
    const b = (el as unknown as Raw)['$body'];
    return typeof b === 'string' && b.trim() ? b : undefined;
  }

  isGeneric(el: El): boolean {
    return !!descriptorOf(el).isGeneric;
  }

  keyOf(el: El): { attr: string; value: string } | undefined {
    const attrs = this.attrsOf(el);
    for (const k of EXTENSION_STRUCTURE.keysOf(this.typeOf(el))) if (attrs[k] !== undefined) return { attr: k, value: attrs[k]! };
    return undefined;
  }

  /** `camunda:inputParameter[name=a]` */
  itemLabel(el: El): string {
    const key = this.keyOf(el);
    return key ? `${el.$type}[${key.attr}=${key.value}]` : el.$type;
  }

  pathOf(el: El): string {
    const steps: string[] = [];
    for (let cur: El | undefined = el; cur && !is(cur, 'bpmn:ExtensionElements'); cur = cur.$parent as El | undefined) {
      const parent = cur.$parent as El | undefined;
      const siblings = parent && is(parent, 'bpmn:ExtensionElements') ? many(parent, 'values') : parent ? this.kidsOf(parent) : [cur];
      const same = siblings.filter((s) => s.$type === cur!.$type);
      const key = this.keyOf(cur);
      steps.unshift(key ? this.itemLabel(cur) : same.length > 1 ? `${cur.$type}[${same.indexOf(cur)}]` : cur.$type);
    }
    return steps.join('/');
  }

  private canonical(uri: string | undefined, local: string, fallback: string): string {
    const p = uri ? CANONICAL_PREFIX[uri] : undefined;
    if (p) return `${p}:${local}`;
    return uri ? `{${uri}}${local}` : fallback;
  }

  private filePrefixFor(uri: string): string | undefined {
    for (const [k, v] of Object.entries(this.doc.definitions.$attrs as Record<string, unknown>)) {
      if (k.startsWith('xmlns:') && v === uri) return k.slice(6);
    }
    return undefined;
  }

  private bpmnPrefix(): string {
    return this.filePrefixFor(BPMN_NS) ?? 'bpmn';
  }

  private splitName(name: string, el: El): { prefix: string; local: string } {
    const m = NAME_RE.exec(name.trim());
    if (!m) {
      throw modelError('E_INVALID_VALUE', `"${name}" is not a prefixed element name (expected prefix:localName, e.g. zeebe:taskDefinition)`, { element: this.hosts.idOf(el) });
    }
    if (m[1] === 'xmlns') throw modelError('E_INVALID_VALUE', `"${name}" is not an element name`, { element: this.hosts.idOf(el) });
    return { prefix: m[1]!, local: m[2]! };
  }

  private refuseBpmnAtTop(type: string, prefix: string, el: El): never {
    throw modelError('E_INVALID_VALUE', `Extension elements must belong to a vendor namespace, not "${prefix}:" (${type} at the top level of extensionElements)`, {
      element: this.hosts.idOf(el),
      hint: 'Use a vendor prefix such as zeebe: or camunda:. bpmn: elements are accepted inside a vendor element (a timeout camunda:taskListener with bpmn:timerEventDefinition, camunda:potentialStarter with bpmn:resourceAssignmentExpression).',
    });
  }

  /** No prefix when BPMN is the file's default namespace. */
  private qnameValue(value: string, scope: Record<string, string>): string {
    const m = NAME_RE.exec(value.trim());
    if (!m) return value;
    const uri = scope[m[1]!] ?? (m[1] === 'bpmn' ? BPMN_NS : undefined);
    if (uri !== BPMN_NS) return value;
    const attrs = this.doc.definitions.$attrs as Record<string, unknown>;
    if (!this.filePrefixFor(BPMN_NS) && attrs['xmlns'] === BPMN_NS) return m[2]!;
    return `${this.bpmnPrefix()}:${m[2]}`;
  }
}

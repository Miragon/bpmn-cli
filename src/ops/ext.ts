/**
 * `ext`: vendor extension elements inside <bpmn:extensionElements>.
 *
 * Vendor content stays generic in the model (camunda-bpmn-moddle is never
 * registered, see src/platform/descriptor.ts); this module knows just enough
 * of its structure to never write a file the engines reject or ignore.
 *
 * CONTRACT
 *  - add: op.type is `prefix:localName` or a path of such steps
 *    (`camunda:connector/camunda:inputParameter`, see "selectors"). The
 *    namespace comes from a snippet-local xmlns, the file's xmlns declarations
 *    or KNOWN_NAMESPACES (else E_UNKNOWN_NAMESPACE); when the file already
 *    binds that namespace URI to another prefix, the file's prefix is used
 *    (never a second prefix for one URI). A bpmn: element is refused at the
 *    top level of extensionElements (E_INVALID_VALUE) and accepted nested in a
 *    vendor element (timeout task listener -> bpmn:timerEventDefinition,
 *    camunda:potentialStarter -> bpmn:resourceAssignmentExpression).
 *    op.xml: a raw snippet; each root element is inserted. With op.type as
 *    well, every root must be of that type (E_INVALID_VALUE otherwise).
 *  - structure rules applied on insert (STRUCTURE below):
 *    - child types go into their container, created when missing:
 *      camunda:inputParameter / camunda:outputParameter -> camunda:inputOutput,
 *      camunda:formField -> camunda:formData, camunda:property ->
 *      camunda:properties, camunda:connectorId -> camunda:connector,
 *      zeebe:input / zeebe:output -> zeebe:ioMapping, zeebe:header ->
 *      zeebe:taskHeaders, zeebe:property -> zeebe:properties, ...
 *      (camunda containers come from the descriptor: a type that may only be
 *      nested and has exactly one container type, which may sit in
 *      extensionElements). Inside a path the same rule applies one level down
 *      (camunda:connector/camunda:inputParameter -> the connector's inputOutput).
 *    - keyed items (KEYS): an item with the same type and key (name / id /
 *      target / key) is replaced in place and reported; what the old item
 *      held and the new one does not (attributes, value, children) is
 *      W_PROPERTY_DROPPED, its hint the --xml that keeps it (not with
 *      --replace, which asks for the whole item).
 *    - single-instance types (SINGLE_TOP, SINGLE_CHILD): a second one is
 *      merged into the existing one (attributes, body, children with the same
 *      rules); a conflicting attribute or body, or a file that already holds
 *      several of them, fails with E_DUPLICATE_EXTENSION (hint --replace).
 *    - op.replace: elements of the same type (and key) at the insertion level
 *      are removed first, the new one is appended (whole-container replace).
 *    - a camunda type that may only be nested and has no unique container
 *      (camunda:value, camunda:validation, camunda:script, ...) or a
 *      camunda:field on an element that does not read fields is added as
 *      given with W_MISPLACED_EXTENSION and a path hint.
 *    - bpmn:definitions (and DI elements) cannot hold extensionElements
 *      (BPMN 2.0 XSD; the engines reject it): E_WRONG_KIND.
 *  - remove: by index (top level; op.type may carry it as in the CLI: `2`,
 *    `loop.2`, `definition[1].0`) or by selector. One step without predicate
 *    removes every element of that type at the top level (or, when there is
 *    none, inside its container: `camunda:inputParameter` removes the input
 *    parameters); `type[attr=value]` / `type[n]` pick one item; a path
 *    selects inside containers. A container left empty (camunda:inputOutput
 *    without parameters, ...) is removed too, an empty extensionElements as
 *    well. Nothing matching: E_NO_EXTENSION listing what is there.
 *  - listExtensions(): [{index, type, attrs, body?, children?: [...]}] for
 *    `ext list` and for `show <id>`.
 *  - nested elements: a `definition.` / `loop.` / `condition.` prefix (or
 *    op.slot); one of several event definitions: `definition[<n>].` /
 *    `definition[<trigger>].` (E_AMBIGUOUS_NESTED without it, see set.ts).
 *
 * Selectors: `step('/'step)*`, step = `prefix:localName` optionally followed
 * by `[attr=value]` (value may be quoted) or `[n]` (0-based among the
 * matching siblings). Quote them in a shell: `'camunda:inputParameter[name=x]'`.
 *
 * NOTE: bpmn-moddle's fromXML is asynchronous while ops run synchronously, so
 * the snippet is parsed by the small synchronous XML reader below into
 * exactly the generic elements moddle would create (same $type / attrs /
 * $body / $children shape, verified against moddle's own parse).
 */
import type { Doc } from '../document.js';
import { modelError, usageError, type Warning } from '../errors.js';
import { addTo, BPMN_NS, is, many, removeFrom, type El } from '../model.js';
import { allowedOn, allowedParents, CAMUNDA_URI, containersOf, OPERATON_URI, ZEEBE_URI } from '../platform/descriptor.js';
import { zeebeAllowedOn, zeebeType } from '../platform/zeebe.js';
import { ChangeSet } from '../result.js';
import { kindLabel } from '../kinds.js';
import { coversProfileSubjects } from './covers.js';
import { changeOf, descriptorOf, idOf, isEl, nestedEntries, NESTED_SLOTS, parseSlotRef, resolveNested, SLOT_TEXT, slotsOf, type NestedSlot } from './set.js';
import type { ExtOp } from './types.js';

export interface ExtensionInfo {
  index: number;
  /**
   * set for the extension elements of a nested element (`ext list`): definition / loop / condition,
   * `definition[<n>]` for one of several event definitions of an event
   */
  slot?: string;
  type: string;
  attrs: Record<string, string>;
  body?: string;
  children?: Array<Omit<ExtensionInfo, 'index'>>;
}

const NAME_RE = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/;


/* ------------------------------------------------------------------ */
/* structure rules                                                      */
/* ------------------------------------------------------------------ */

/**
 * Types that occur at most once in bpmn:extensionElements (canonical names:
 * camunda: / zeebe: by namespace URI, whatever prefix a file uses).
 */
export const SINGLE_TOP: ReadonlySet<string> = new Set([
  // Camunda 7: a second one makes Camunda 7.24, CIB seven 2.2 and Operaton 2.1
  // reject the deployment (ENGINE-01009 "multiple elements with tag name ... found")
  'camunda:inputOutput',
  'camunda:formData',
  'camunda:connector',
  'camunda:failedJobRetryTimeCycle',
  // the engines accept two, but the Camunda Modeler and the C7 model API read
  // only one; merging them loses nothing
  'camunda:properties',
  // Zeebe (zeebe-bpmn-moddle): the Zeebe model reads one element of each
  'zeebe:ioMapping',
  'zeebe:taskHeaders',
  'zeebe:properties',
  'zeebe:taskDefinition',
  'zeebe:formDefinition',
  'zeebe:assignmentDefinition',
  'zeebe:priorityDefinition',
  'zeebe:taskSchedule',
  'zeebe:calledElement',
  'zeebe:calledDecision',
  'zeebe:loopCharacteristics',
  'zeebe:subscription',
  'zeebe:script',
  'zeebe:userTask',
  'zeebe:versionTag',
  'zeebe:executionListeners',
  'zeebe:taskListeners',
  'zeebe:linkedResources',
  // Camunda 8.9 refuses a second one (engine-checked, test/c8-profile.test.ts)
  'zeebe:adHoc',
  'zeebe:conditionalFilter',
  'zeebe:publishMessage',
]);

/** Children that occur at most once inside their vendor parent. */
export const SINGLE_CHILD: Readonly<Record<string, readonly string[]>> = {
  // engine-verified: a second one is ENGINE-01009 on all three C7 engines
  'camunda:connector': ['camunda:connectorId', 'camunda:inputOutput'],
  'camunda:formField': ['camunda:properties', 'camunda:validation'],
  'camunda:executionListener': ['camunda:script'],
  'camunda:taskListener': ['camunda:script'],
  // single-valued properties of the descriptor
  'camunda:field': ['camunda:string', 'camunda:expression'],
  'camunda:potentialStarter': ['bpmn:resourceAssignmentExpression'],
};

/** Identity of repeatable items: same type and same value of the first attribute present = the same item (adding replaces it). */
export const KEYS: Readonly<Record<string, readonly string[]>> = {
  'camunda:inputParameter': ['name'],
  'camunda:outputParameter': ['name'],
  'camunda:formField': ['id'],
  'camunda:property': ['name', 'id'],
  'camunda:field': ['name'],
  'camunda:constraint': ['name'],
  'camunda:value': ['id'],
  'camunda:entry': ['key'],
  'zeebe:input': ['target'],
  'zeebe:output': ['target'],
  'zeebe:header': ['key'],
  'zeebe:property': ['name'],
};

/** Containers of child types the camunda descriptor does not describe as types (and all Zeebe ones). */
const STATIC_HOMES: Readonly<Record<string, string>> = {
  'camunda:connectorId': 'camunda:connector', // a String property of camunda:Connector, written as an element
  'zeebe:input': 'zeebe:ioMapping',
  'zeebe:output': 'zeebe:ioMapping',
  'zeebe:header': 'zeebe:taskHeaders',
  'zeebe:property': 'zeebe:properties',
  'zeebe:executionListener': 'zeebe:executionListeners',
  'zeebe:taskListener': 'zeebe:taskListeners',
  'zeebe:linkedResource': 'zeebe:linkedResources',
};

/** Child order of containers whose schema is a sequence (camunda.xsd / zeebe.xsd, the order the modelers write). */
const CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
  'camunda:inputOutput': ['camunda:inputParameter', 'camunda:outputParameter'],
  'camunda:connector': ['camunda:inputOutput', 'camunda:connectorId'],
  'camunda:formField': ['camunda:properties', 'camunda:validation', 'camunda:value'],
  'camunda:executionListener': ['camunda:script', 'camunda:field'],
  'camunda:taskListener': ['camunda:script', 'camunda:field', 'bpmn:timerEventDefinition'],
  'zeebe:ioMapping': ['zeebe:input', 'zeebe:output'],
};

/** Containers that mean nothing once empty: removed with their last child. */
const PURE_CONTAINERS: ReadonlySet<string> = new Set([
  'camunda:inputOutput',
  'camunda:formData',
  'camunda:properties',
  'camunda:validation',
  'zeebe:ioMapping',
  'zeebe:taskHeaders',
  'zeebe:properties',
  'zeebe:executionListeners',
  'zeebe:taskListeners',
  'zeebe:linkedResources',
]);

/**
 * Operaton's own namespace holds the camunda types under another URI
 * (Operaton reads it first, camunda:* as the fallback). Its elements keep
 * their canonical name (`operaton:inputOutput`: never merged into a
 * camunda:inputOutput, Operaton reads one of each), the structure rules above
 * apply to them by local name (ruleName), and a container created for an
 * operaton item is an operaton one (inFamily).
 */
function ruleName(type: string): string {
  return type.startsWith('operaton:') ? `camunda:${type.slice('operaton:'.length)}` : type;
}

/** A camunda type name in the namespace family of `like` (`operaton:inputOutput` for an operaton item). */
function inFamily(type: string, like: string): string {
  return like.startsWith('operaton:') && type.startsWith('camunda:') ? `operaton:${type.slice('camunda:'.length)}` : type;
}

function isCamunda(type: string): boolean {
  return ruleName(type).startsWith('camunda:');
}

/** A camunda type that may only appear inside another vendor element (descriptor: no allowedIn, but a container). */
function nestedOnly(type: string): boolean {
  const t = ruleName(type);
  return isCamunda(t) && !allowedParents(t).some((p) => p === '*' || p.startsWith('bpmn:')) && containersOf(t).length > 0;
}

/** True when vendor type `parent` holds `child` as a direct child. */
function holds(parent: string, child: string): boolean {
  const p = ruleName(parent);
  const c = ruleName(child);
  if (SINGLE_CHILD[p]?.includes(c)) return true;
  if (STATIC_HOMES[c] === p) return true;
  return isCamunda(c) && containersOf(c).includes(p);
}

/** The one container type of a child type, if it has exactly one (in the child's namespace family). */
function containerOf(type: string): string | undefined {
  const t = ruleName(type);
  const fixed = STATIC_HOMES[t];
  if (fixed) return inFamily(fixed, type);
  if (!nestedOnly(t)) return undefined;
  const all = containersOf(t);
  return all.length === 1 ? inFamily(all[0]!, type) : undefined;
}

/**
 * Where an item of `type` goes when it is inserted at a level of type
 * `levelType` (undefined = the top of extensionElements) but does not belong
 * there itself: the container type to find or create there, or undefined.
 */
function homeAt(type: string, levelType: string | undefined): string | undefined {
  if (levelType !== undefined && holds(levelType, type)) return undefined;
  const home = containerOf(type);
  if (!home) return undefined;
  if (levelType === undefined) return STATIC_HOMES[ruleName(type)] || !nestedOnly(home) ? home : undefined;
  return holds(levelType, home) ? home : undefined;
}

/** A path step that `ext add` may create when it is missing: a container that needs no attributes of its own. */
function creatable(type: string): boolean {
  const t = ruleName(type);
  return PURE_CONTAINERS.has(t) || SINGLE_TOP.has(t) || Object.values(SINGLE_CHILD).some((c) => c.includes(t));
}

function isSingle(type: string, levelType: string | undefined): boolean {
  return levelType === undefined ? SINGLE_TOP.has(ruleName(type)) : !!SINGLE_CHILD[ruleName(levelType)]?.includes(ruleName(type));
}

/* ------------------------------------------------------------------ */
/* names and namespaces                                                 */
/* ------------------------------------------------------------------ */

const CANONICAL_PREFIX: Readonly<Record<string, string>> = { [CAMUNDA_URI]: 'camunda', [OPERATON_URI]: 'operaton', [ZEEBE_URI]: 'zeebe', [BPMN_NS]: 'bpmn' };
/** The namespace URI of a canonical prefix. */
const CANONICAL_URI: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(CANONICAL_PREFIX).map(([uri, prefix]) => [prefix, uri]));

function canonical(uri: string | undefined, local: string, fallback: string): string {
  const p = uri ? CANONICAL_PREFIX[uri] : undefined;
  if (p) return `${p}:${local}`;
  return uri ? `{${uri}}${local}` : fallback;
}

/** Canonical type of a vendor element (camunda: / zeebe: / bpmn: by namespace URI). */
function typeOf(doc: Doc, el: El): string {
  const ns = (el.$descriptor as { ns?: { prefix?: string; localName?: string; uri?: string } } | undefined)?.ns;
  const [prefix, local] = el.$type.includes(':') ? (el.$type.split(':') as [string, string]) : ['', el.$type];
  const uri = ns?.uri ?? (prefix === 'bpmn' ? BPMN_NS : doc.namespaceUri(prefix));
  return canonical(uri, ns?.localName ?? local, el.$type);
}

/** Canonical form of a user-given `prefix:localName` (no declaration side effects). */
function canonicalName(doc: Doc, name: string, scope: Record<string, string> = {}): string {
  const m = NAME_RE.exec(name.trim());
  if (!m) return name.trim();
  const uri = scope[m[1]!] ?? (m[1] === 'bpmn' ? BPMN_NS : doc.namespaceUri(m[1]!));
  return canonical(uri, m[2]!, name.trim());
}

/** The prefix the file declares for `uri` on bpmn:definitions, if any. */
function filePrefixFor(doc: Doc, uri: string): string | undefined {
  for (const [k, v] of Object.entries(doc.definitions.$attrs as Record<string, unknown>)) {
    if (k.startsWith('xmlns:') && v === uri) return k.slice(6);
  }
  return undefined;
}

function bpmnPrefix(doc: Doc): string {
  return filePrefixFor(doc, BPMN_NS) ?? 'bpmn';
}

/**
 * The prefix to write for `prefix` (resolved through the snippet scope, the
 * file and the known list) and its URI. A URI the file already binds keeps the
 * file's prefix; a new one is declared on bpmn:definitions.
 */
function resolvePrefix(doc: Doc, el: El, prefix: string, scope: Record<string, string>): { prefix: string; uri: string } {
  const inline = scope[prefix];
  if (inline === BPMN_NS || (inline === undefined && prefix === 'bpmn')) return { prefix: bpmnPrefix(doc), uri: BPMN_NS };
  const uri = inline ?? doc.namespaceUri(prefix);
  if (!uri) {
    doc.declareNamespace(prefix); // throws E_UNKNOWN_NAMESPACE with the standard hint
    return { prefix, uri: doc.namespaceUri(prefix)! };
  }
  const existing = filePrefixFor(doc, uri);
  if (existing) return { prefix: existing, uri };
  const bound = (doc.definitions.$attrs as Record<string, unknown>)[`xmlns:${prefix}`];
  if (typeof bound === 'string' && bound !== uri) {
    throw modelError('E_INVALID_XML', `The prefix "${prefix}" is bound to ${bound} in the file, the snippet binds it to ${uri}`, {
      element: hostId(el),
      hint: `Use another prefix for ${uri} in the snippet.`,
    });
  }
  doc.declareNamespace(prefix, uri);
  return { prefix, uri };
}

function splitName(name: string, el: El): { prefix: string; local: string } {
  const m = NAME_RE.exec(name.trim());
  if (!m) {
    throw modelError('E_INVALID_VALUE', `"${name}" is not a prefixed element name (expected prefix:localName, e.g. zeebe:taskDefinition)`, { element: hostId(el) });
  }
  if (m[1] === 'xmlns') throw modelError('E_INVALID_VALUE', `"${name}" is not an element name`, { element: hostId(el) });
  return { prefix: m[1]!, local: m[2]! };
}

function refuseBpmnAtTop(type: string, prefix: string, el: El): never {
  throw modelError('E_INVALID_VALUE', `Extension elements must belong to a vendor namespace, not "${prefix}:" (${type} at the top level of extensionElements)`, {
    element: hostId(el),
    hint: 'Use a vendor prefix such as zeebe: or camunda:. bpmn: elements are accepted inside a vendor element (a timeout camunda:taskListener with bpmn:timerEventDefinition, camunda:potentialStarter with bpmn:resourceAssignmentExpression).',
  });
}

/** Creates a generic element `name` with attributes (prefixed attribute names resolved like element names). */
function createGeneric(doc: Doc, el: El, name: string, attrs: Record<string, string>, body: string | undefined, scope: Record<string, string>, nested: boolean): El {
  const { prefix, local } = splitName(name, el);
  const ns = resolvePrefix(doc, el, prefix, scope);
  if (ns.uri === BPMN_NS && !nested) refuseBpmnAtTop(name, prefix, el);
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const m = NAME_RE.exec(key);
    if (!m || m[1] === 'xmlns') {
      props[key] = value;
      continue;
    }
    const a = resolvePrefix(doc, el, m[1]!, scope);
    props[`${a.prefix}:${m[2]}`] = m[1] === 'xsi' && m[2] === 'type' ? qnameValue(doc, value, scope) : value;
  }
  if (body !== undefined && body !== '') props['$body'] = body;
  return doc.moddle.createAny(`${ns.prefix}:${local}`, ns.uri, props) as unknown as El;
}

/** An xsi:type value such as `bpmn:tFormalExpression` with the file's BPMN prefix (none when BPMN is the file's default namespace). */
function qnameValue(doc: Doc, value: string, scope: Record<string, string>): string {
  const m = NAME_RE.exec(value.trim());
  if (!m) return value;
  const uri = scope[m[1]!] ?? (m[1] === 'bpmn' ? BPMN_NS : undefined);
  if (uri !== BPMN_NS) return value;
  const attrs = doc.definitions.$attrs as Record<string, unknown>;
  if (!filePrefixFor(doc, BPMN_NS) && attrs['xmlns'] === BPMN_NS) return m[2]!;
  return `${bpmnPrefix(doc)}:${m[2]}`;
}

/* ------------------------------------------------------------------ */
/* generic element access                                               */
/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function kidsOf(el: El): El[] {
  const kids = (el as unknown as Raw)['$children'];
  return Array.isArray(kids) ? kids.filter(isEl) : [];
}

function attrsOf(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el as unknown as Raw)) {
    if (k.startsWith('$') || v === undefined || v === null || typeof v === 'object' || typeof v === 'function') continue;
    out[k] = String(v);
  }
  return out;
}

function bodyOf(el: El): string | undefined {
  const b = (el as unknown as Raw)['$body'];
  return typeof b === 'string' && b.trim() ? b : undefined;
}

function isGeneric(el: El): boolean {
  return !!descriptorOf(el).isGeneric;
}

function keyOf(doc: Doc, el: El): { attr: string; value: string } | undefined {
  const attrs = attrsOf(el);
  for (const k of KEYS[ruleName(typeOf(doc, el))] ?? []) if (attrs[k] !== undefined) return { attr: k, value: attrs[k]! };
  return undefined;
}

/** `camunda:inputParameter[name=a]` (type as written in the file, key when the type has one). */
function itemLabel(doc: Doc, el: El): string {
  const key = keyOf(doc, el);
  return key ? `${el.$type}[${key.attr}=${key.value}]` : el.$type;
}

/* ------------------------------------------------------------------ */
/* levels: the top of extensionElements or the children of a vendor el  */
/* ------------------------------------------------------------------ */

class Level {
  constructor(
    private readonly doc: Doc,
    readonly host: El,
    /** the vendor element whose children this level is; undefined = top of extensionElements */
    readonly parent?: El,
  ) {}

  get type(): string | undefined {
    return this.parent ? typeOf(this.doc, this.parent) : undefined;
  }

  get label(): string {
    return this.parent ? itemLabel(this.doc, this.parent) : 'extensionElements';
  }

  items(): El[] {
    if (this.parent) return kidsOf(this.parent);
    const c = this.host.get<El | undefined>('extensionElements');
    return c ? [...many(c, 'values')] : [];
  }

  /** Appends `el`, before the first child that comes later in the container's sequence (CHILD_ORDER). */
  append(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = Array.isArray(raw['$children']) ? (raw['$children'] as El[]) : [];
      const order = CHILD_ORDER[ruleName(this.type!)];
      const rank = (e: El): number => (order ? order.indexOf(ruleName(typeOf(this.doc, e))) : -1);
      const mine = rank(el);
      const at = mine === -1 ? -1 : kids.findIndex((k) => rank(k) > mine);
      if (at === -1) kids.push(el);
      else kids.splice(at, 0, el);
      raw['$children'] = kids;
      el.$parent = this.parent;
      return;
    }
    addTo(ensureContainer(this.doc, this.host), 'values', el);
  }

  replace(old: El, el: El): void {
    const list = this.parent ? ((this.parent as unknown as Raw)['$children'] as El[]) : many(this.host.get<El>('extensionElements'), 'values');
    const i = list.indexOf(old);
    list[i] = el;
    el.$parent = this.parent ?? this.host.get<El>('extensionElements');
  }

  remove(el: El): void {
    if (this.parent) {
      const raw = this.parent as unknown as Raw;
      const kids = raw['$children'] as El[] | undefined;
      if (!kids) return;
      const i = kids.indexOf(el);
      if (i !== -1) kids.splice(i, 1);
      if (!kids.length) delete raw['$children'];
      return;
    }
    const c = this.host.get<El | undefined>('extensionElements');
    if (c) removeFrom(c, 'values', el);
  }
}

function ensureContainer(doc: Doc, el: El): El {
  let container = el.get<El | undefined>('extensionElements');
  if (!container) {
    container = doc.moddle.create('bpmn:ExtensionElements');
    container.$parent = el;
    el.set('extensionElements', container);
  }
  return container;
}

/** The level whose items are the children of a vendor element (its parent chain decides the host). */
function levelOf(doc: Doc, host: El, parent: El): Level {
  return new Level(doc, host, parent);
}

/* ------------------------------------------------------------------ */
/* selectors                                                            */
/* ------------------------------------------------------------------ */

interface Step {
  name: string;
  attr?: string;
  value?: string;
  index?: number;
  text: string;
}

function badSelector(text: string, why: string, el: El): never {
  throw modelError('E_INVALID_VALUE', `"${text}" is not a valid extension selector: ${why}`, {
    element: hostId(el),
    hint: "A selector is prefix:type, optionally with [attr=value] or [index], steps joined by '/', e.g. 'camunda:inputParameter[name=customerId]' or 'camunda:connector/camunda:inputOutput/camunda:inputParameter[name=url]'. Quote it in the shell.",
  });
}

/** Parses `a:b[attr=value]/c:d[0]`. */
export function parseSelector(text: string, el: El): Step[] {
  const s = text.trim();
  const steps: Step[] = [];
  const nameRe = /[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/y;
  let i = 0;
  for (;;) {
    nameRe.lastIndex = i;
    const m = nameRe.exec(s);
    if (!m) badSelector(text, `expected prefix:type at offset ${i}`, el);
    const start = i;
    const step: Step = { name: m[0], text: m[0] };
    i = nameRe.lastIndex;
    if (s[i] === '[') {
      let j = i + 1;
      let quote: string | undefined;
      for (; j < s.length; j++) {
        const ch = s[j]!;
        if (quote) {
          if (ch === quote) quote = undefined;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ']') break;
      }
      if (j >= s.length) badSelector(text, 'unclosed [', el);
      const inner = s.slice(i + 1, j).trim();
      if (/^\d+$/.test(inner)) step.index = Number(inner);
      else {
        const eq = inner.indexOf('=');
        if (eq <= 0) badSelector(text, `expected [attr=value] or [index], got [${inner}]`, el);
        step.attr = inner.slice(0, eq).trim();
        let v = inner.slice(eq + 1).trim();
        if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
        step.value = v;
      }
      i = j + 1;
      step.text = s.slice(start, i);
    }
    steps.push(step);
    if (i === s.length) return steps;
    if (s[i] !== '/') badSelector(text, `unexpected "${s[i]}" at offset ${i}`, el);
    i++;
  }
}

function matchesStep(doc: Doc, el: El, step: Step, wanted: string): boolean {
  if (typeOf(doc, el) !== wanted && el.$type !== step.name) return false;
  if (step.attr !== undefined) return attrsOf(el)[step.attr] === step.value;
  return true;
}

/** Items of `level` matching `step` (a child type absent at this level is looked up in its container). */
function selectAt(doc: Doc, level: Level, step: Step): Array<{ el: El; level: Level }> {
  const wanted = canonicalName(doc, step.name);
  const pick = (lv: Level): Array<{ el: El; level: Level }> => {
    const hits = lv.items().filter((e) => matchesStep(doc, e, step, wanted));
    if (step.index !== undefined) {
      const hit = hits[step.index];
      return hit ? [{ el: hit, level: lv }] : [];
    }
    return hits.map((e) => ({ el: e, level: lv }));
  };
  const direct = pick(level);
  if (direct.length) return direct;
  const home = homeAt(wanted, level.type);
  if (!home) return [];
  return level
    .items()
    .filter((e) => typeOf(doc, e) === home)
    .flatMap((c) => pick(levelOf(doc, level.host, c)));
}

/** Every item below `level` (depth first) matching `step`: the fallback for a predicate the direct lookup does not find. */
function selectDeep(doc: Doc, level: Level, step: Step): Array<{ el: El; level: Level }> {
  const out: Array<{ el: El; level: Level }> = [];
  const wanted = canonicalName(doc, step.name);
  const visit = (lv: Level): void => {
    for (const e of lv.items()) {
      if (matchesStep(doc, e, step, wanted)) out.push({ el: e, level: lv });
      if (isGeneric(e)) visit(levelOf(doc, lv.host, e));
    }
  };
  visit(level);
  return out;
}

/** The selector path of a vendor element from the top of extensionElements (indexes where an item has no key). */
function pathOf(doc: Doc, el: El): string {
  const steps: string[] = [];
  for (let cur: El | undefined = el; cur && !is(cur, 'bpmn:ExtensionElements'); cur = cur.$parent as El | undefined) {
    const parent = cur.$parent as El | undefined;
    const siblings = parent && is(parent, 'bpmn:ExtensionElements') ? many(parent, 'values') : parent ? kidsOf(parent) : [cur];
    const same = siblings.filter((s) => s.$type === cur!.$type);
    const key = keyOf(doc, cur);
    steps.unshift(key ? itemLabel(doc, cur) : same.length > 1 ? `${cur.$type}[${same.indexOf(cur)}]` : cur.$type);
  }
  return steps.join('/');
}

function presentAt(doc: Doc, levels: Level[]): string[] {
  return [...new Set(levels.flatMap((lv) => lv.items().map((e) => itemLabel(doc, e))))];
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

/** Runs an `ext` operation (add / remove). */
export function extensionOp(doc: Doc, op: ExtOp): ChangeSet {
  const owner = doc.require(op.id);
  if (op.action !== 'add' && op.action !== 'remove') throw usageError(`Unknown ext action "${String(op.action)}"; use add or remove`, { element: op.id });
  const notes: string[] = [];
  const { host, op: inner } = resolveHost(doc, owner, normalizeIndex(op), notes);
  const cs = inner.action === 'add' ? addExtension(doc, host, inner) : removeExtension(doc, host, inner);
  for (const n of notes) cs.note(n);
  return cs;
}

/* ------------------------------------------------------------------ */
/* nested hosts: definition. / loop. / condition.                        */
/* ------------------------------------------------------------------ */

/**
 * Nested elements without an id of their own (the event definition, the loop
 * characteristics, the condition expression) hold extension elements too
 * (camunda:failedJobRetryTimeCycle on a multi-instance loop, camunda:field /
 * camunda:connector on a message event definition, camunda:in on a signal
 * event definition). They are addressed like the nested keys of `set`: a
 * `<slot>.` prefix on the type / selector (`loop.camunda:failedJobRetryTimeCycle`)
 * or op.slot. Messages and hints name them through their owner.
 */
const NESTED_HOSTS = new WeakMap<El, { owner: El; slot: NestedSlot; prefix: string }>();

/** The element results and hints name: the owner of a nested host, else the host. */
function ownerOf(host: El): El {
  return NESTED_HOSTS.get(host)?.owner ?? host;
}

/** The id commands take for this host (the owner's id for a nested host). */
function hostId(host: El): string {
  return idOf(ownerOf(host));
}

/** The prefix a type / selector needs in a command for this host: `loop.` (`definition[1].`) for a nested host, '' otherwise. */
function slotPrefix(host: El): string {
  const n = NESTED_HOSTS.get(host);
  return n ? `${n.prefix}.` : '';
}

/** How messages name the host: its id, or `the loop characteristics of Activity_X`. */
function hostLabel(host: El): string {
  const n = NESTED_HOSTS.get(host);
  return n ? `the ${SLOT_TEXT[n.slot]}${n.prefix !== n.slot ? ` ${n.prefix}` : ''} of ${idOf(n.owner)}` : idOf(host);
}

/**
 * `loop.camunda:x` -> { slot: 'loop', rest: 'camunda:x' } for the known slots
 * (`definition[timer].camunda:x` -> slot 'definition[timer]'); undefined otherwise.
 */
export function splitSlot(text: string): { slot: string; rest: string } | undefined {
  const m = /^(\w+(?:\[[^\]]*\])?)\.(.+)$/.exec(text.trim());
  if (!m || !parseSlotRef(m[1]!)) return undefined;
  return { slot: m[1]!, rest: m[2]! };
}

/** `2`, `loop.2`, `definition[1].0`: an index from `ext list` (of the element's own / of a nested element's extension elements). */
export function indexRef(text: string): { slot?: string; index: number } | undefined {
  const m = /^(?:(\w+(?:\[[^\]]*\])?)\.)?(\d+)$/.exec(text.trim());
  if (!m || (m[1] !== undefined && !parseSlotRef(m[1]))) return undefined;
  return { ...(m[1] !== undefined ? { slot: m[1] } : {}), index: Number(m[2]) };
}

/**
 * An ext remove whose type is an index from `ext list` (`2`, `loop.2`,
 * `definition[1].0`) is the index form, as on the command line (the ops JSON
 * may give it as "type").
 */
function normalizeIndex(op: ExtOp): ExtOp {
  if (op.action !== 'remove' || op.index !== undefined || op.type === undefined) return op;
  const ref = indexRef(op.type);
  if (!ref) return op;
  if (ref.slot !== undefined && op.slot !== undefined && op.slot !== ref.slot) {
    throw usageError(`"slot": "${op.slot}" and the type prefix ${ref.slot}. disagree`, { element: op.id, hint: 'Give the slot once: as the prefix (loop.0) or as "slot".' });
  }
  const { type: _type, ...rest } = op;
  const slot = ref.slot ?? op.slot;
  return { ...rest, index: ref.index, ...(slot !== undefined ? { slot: slot as ExtOp['slot'] } : {}) };
}

/**
 * The element the op works on: `owner`, or its nested element named by op.slot
 * / a `<slot>.` prefix of op.type. Adding a zeebe:loopCharacteristics to an
 * activity without loop creates a parallel multi-instance loop for it (what
 * the element configures; `notes` says so), like `set loop.<key>=` does.
 */
function resolveHost(doc: Doc, owner: El, op: ExtOp, notes: string[] = []): { host: El; op: ExtOp } {
  const split = op.type ? splitSlot(op.type) : undefined;
  if (split && op.slot && op.slot !== split.slot) {
    throw usageError(`"slot": "${op.slot}" and the type prefix ${split.slot}. disagree`, { element: idOf(owner), hint: 'Give the slot once: as the type prefix (loop.camunda:...) or as "slot".' });
  }
  const slotText: string | undefined = split?.slot ?? op.slot;
  if (slotText === undefined) return { host: owner, op };
  const id = idOf(owner);
  const ref = parseSlotRef(slotText);
  if (!ref) {
    throw usageError(`Unknown slot "${String(slotText)}"; use ${NESTED_SLOTS.join(', ')}`, { element: id });
  }
  const slot = ref.slot;
  if (!slotsOf(owner).includes(slot)) {
    throw modelError('E_WRONG_KIND', `${kindLabel(owner)} ${id} has no ${SLOT_TEXT[slot]} (${slot}.)`, {
      element: id,
      hint: 'definition. addresses the event definition of an event, loop. the loop characteristics of an activity, condition. the condition expression of a sequence flow or conditional event.',
    });
  }
  const what = split?.rest ?? (op.index !== undefined ? String(op.index) : (op.type ?? '<type>'));
  let nested = resolveNested(owner, ref, `${ref.text}.${what}`, (prefix) => `bpmn ext ${op.action} <file> ${id} '${prefix}.${what}'${op.action === 'add' ? ' ...' : ''}`);
  const zeebeLoop = (op.type !== undefined && canonicalName(doc, split?.rest ?? op.type) === 'zeebe:loopCharacteristics') || (op.xml !== undefined && /^\s*<[\w.-]+:loopCharacteristics[\s/>]/.test(op.xml) && op.type === undefined);
  if (!nested && op.action === 'add' && slot === 'loop' && zeebeLoop && !owner.get<El | undefined>('loopCharacteristics')) {
    nested = doc.moddle.create('bpmn:MultiInstanceLoopCharacteristics');
    nested.$parent = owner;
    owner.set('loopCharacteristics', nested);
    notes.push(`${id}: created a parallel multi-instance loop for loop.${split?.rest ?? 'zeebe:loopCharacteristics'} (\`bpmn set <file> ${id} loop=sequential\` runs the items one after the other)`);
  }
  if (!nested) {
    const first: Record<NestedSlot, string> = {
      definition: `give it a trigger first: \`bpmn set <file> ${id} trigger=<message|timer|error|signal|...>\``,
      loop:
        doc.platform() === 'camunda8'
          ? `make it a multi-instance first: \`bpmn ext add <file> ${id} loop.zeebe:loopCharacteristics inputCollection==<items> inputElement=<item>\` (creates a parallel loop; \`bpmn set <file> ${id} loop=sequential\` for one after the other)`
          : `make it a loop first: \`bpmn set <file> ${id} loop=parallel\` (or sequential, or 'loop.camunda:collection=\${items}')`,
      condition: `give it a condition first: \`bpmn set <file> ${id} 'condition=\${...}'\` (conditional events: when=)`,
    };
    throw modelError(op.action === 'remove' ? 'E_NO_EXTENSION' : 'E_NO_NESTED_ELEMENT', `${kindLabel(owner)} ${id} has no ${SLOT_TEXT[slot]}${op.action === 'remove' ? ', so no extension elements there' : ' to hold extension elements'}`, {
      element: id,
      hint: op.action === 'remove' ? 'Nothing to remove; `bpmn ext list <file> <id>` shows what is there.' : `${first[slot][0]!.toUpperCase()}${first[slot].slice(1)}.`,
    });
  }
  NESTED_HOSTS.set(nested, { owner, slot, prefix: ref.text });
  const { slot: _slot, ...rest } = op;
  return { host: nested, op: { ...rest, ...(split ? { type: split.rest } : {}) } };
}

/* ------------------------------------------------------------------ */
/* add                                                                  */
/* ------------------------------------------------------------------ */

/** What one insert did, for the change detail. */
interface Outcome {
  verb: 'added' | 'replaced' | 'merged' | 'unchanged';
  text: string;
}

function assertCanHoldExtensions(el: El): void {
  if (is(el, 'bpmn:Definitions')) {
    throw modelError('E_WRONG_KIND', `${hostLabel(el)} is the bpmn:definitions element, which cannot hold extension elements (BPMN 2.0 XSD; the engines reject such a file)`, {
      element: hostId(el),
      hint: 'Put process-level extensions on the process: `bpmn ext add <file> <processId> camunda:properties ...` (`bpmn show <file>` lists the process id).',
    });
  }
  if (!is(el, 'bpmn:BaseElement')) {
    throw modelError('E_WRONG_KIND', `${hostLabel(el) || el.$type} (${el.$type}) cannot hold bpmn:extensionElements`, {
      element: hostId(el),
      hint: 'Extension elements belong to BPMN elements: processes, flow nodes, flows, event definitions, ...',
    });
  }
}

function duplicate(doc: Doc, host: El, message: string, related?: string): never {
  throw modelError('E_DUPLICATE_EXTENSION', message, {
    element: hostId(host),
    hint: `Pass --replace to replace it as a whole${related ? ` (ext add <file> ${hostId(host)} ${slotPrefix(host)}${related} ... --replace)` : ''}, or remove the old one first with \`bpmn ext remove <file> ${hostId(host)} ${slotPrefix(host)}<selector>\` (see \`bpmn ext list\`).`,
  });
}

/** Refuses an insert that would need --replace (mutates nothing). */
function checkInsert(doc: Doc, host: El, items: El[], levelType: string | undefined, value: El, replace: boolean): void {
  const t = typeOf(doc, value);
  const home = homeAt(t, levelType);
  if (home) {
    const homes = items.filter((e) => typeOf(doc, e) === home);
    if (homes.length > 1) duplicate(doc, host, `${hostLabel(host)} already has ${homes.length} ${homes[0]!.$type} elements; ${value.$type} cannot be placed unambiguously (the engines reject more than one)`, homes[0]!.$type);
    if (homes.length === 1) checkInsert(doc, host, kidsOf(homes[0]!), home, value, replace);
    return;
  }
  if (replace || keyOf(doc, value) || !isSingle(t, levelType)) return;
  const same = items.filter((e) => typeOf(doc, e) === t);
  if (same.length > 1) duplicate(doc, host, `${hostLabel(host)} already has ${same.length} ${same[0]!.$type} elements (only one is allowed); merging into them is ambiguous`, value.$type);
  if (same.length === 1) checkMerge(doc, host, same[0]!, value);
}

function checkMerge(doc: Doc, host: El, existing: El, incoming: El): void {
  const have = attrsOf(existing);
  for (const [k, v] of Object.entries(attrsOf(incoming))) {
    if (have[k] !== undefined && have[k] !== v) {
      duplicate(doc, host, `${hostLabel(host)} already has a ${existing.$type} with ${k}="${have[k]}"; the new one says ${k}="${v}" (only one ${existing.$type} is allowed)`, incoming.$type);
    }
  }
  const hb = bodyOf(existing);
  const ib = bodyOf(incoming);
  if (hb !== undefined && ib !== undefined && hb.trim() !== ib.trim()) {
    duplicate(doc, host, `${hostLabel(host)} already has a ${existing.$type} with the value "${hb.trim()}"; the new one is "${ib.trim()}" (only one ${existing.$type} is allowed)`, incoming.$type);
  }
  if (!isGeneric(existing)) return;
  for (const c of kidsOf(incoming)) checkInsert(doc, host, kidsOf(existing), typeOf(doc, existing), c, false);
}

/** Inserts `value` into `level` by the structure rules (checkInsert ran before); `drops` collects what a keyed replacement lost. */
function insert(doc: Doc, level: Level, value: El, replace: boolean, out: Outcome[], notes: string[], drops: Warning[] = []): void {
  const t = typeOf(doc, value);
  const where = level.parent ? ` in ${level.label}` : '';
  const home = homeAt(t, level.type);
  if (home) {
    let container = level.items().find((e) => typeOf(doc, e) === home);
    if (!container) {
      // a canonical name: written with the prefix the file binds to its namespace
      const [prefix, local] = home.split(':') as [string, string];
      const uri = CANONICAL_URI[prefix];
      const ns = resolvePrefix(doc, level.host, prefix, uri ? { [prefix]: uri } : {});
      container = doc.moddle.createAny(`${ns.prefix}:${local}`, ns.uri, {}) as unknown as El;
      level.append(container);
      notes.push(`created ${container.$type}${where} for ${value.$type}`);
    }
    insert(doc, levelOf(doc, level.host, container), value, replace, out, notes, drops);
    return;
  }
  const into = level.parent ? ` to ${level.label}` : '';
  const same = level.items().filter((e) => typeOf(doc, e) === t);
  const key = keyOf(doc, value);
  if (key) {
    const match = same.filter((e) => attrsOf(e)[key.attr] === key.value);
    if (match.length) {
      if (!replace) {
        const drop = keyedDrop(doc, level, match, value);
        if (drop) drops.push(drop);
      }
      level.replace(match[0]!, value);
      for (const extra of match.slice(1)) level.remove(extra);
      out.push({ verb: 'replaced', text: `${itemLabel(doc, value)}${level.parent ? ` in ${level.label}` : ''}` });
      notes.push(`replaced the existing ${itemLabel(doc, value)}${level.parent ? ` in ${level.label}` : ''} of ${hostLabel(level.host)}`);
      return;
    }
    level.append(value);
    out.push({ verb: 'added', text: `${itemLabel(doc, value)}${into}` });
    return;
  }
  if (replace && same.length) {
    for (const e of same) level.remove(e);
    level.append(value);
    out.push({ verb: 'replaced', text: `${value.$type}${level.parent ? ` in ${level.label}` : ''}` });
    notes.push(`replaced ${same.length} existing ${value.$type}`);
    return;
  }
  if (same.length === 1 && isSingle(t, level.type)) {
    out.push(merge(doc, level, same[0]!, value, notes, drops));
    return;
  }
  level.append(value);
  out.push({ verb: 'added', text: `${itemLabel(doc, value)}${into}` });
}

/* keyed replacement: what the replaced item held ---------------------- */

const SNIPPET_MAX = 800;

function escapeXml(text: string, attr: boolean): string {
  const s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attr ? s.replace(/"/g, '&quot;') : s;
}

/** A generic vendor element as an XML snippet (`ext add --xml`); undefined when it holds typed content it cannot write. */
function snippetOf(el: El): string | undefined {
  if (!isGeneric(el)) return undefined;
  const attrs = Object.entries(attrsOf(el))
    .map(([k, v]) => ` ${k}="${escapeXml(v, true)}"`)
    .join('');
  const kids = kidsOf(el).map(snippetOf);
  if (kids.some((k) => k === undefined)) return undefined;
  const body = (el as unknown as Raw)['$body'];
  const text = typeof body === 'string' ? escapeXml(body, false) : '';
  if (!kids.length && !text) return `<${el.$type}${attrs} />`;
  return `<${el.$type}${attrs}>${text}${kids.join('')}</${el.$type}>`;
}

/** `camunda:validation (camunda:constraint[name=min])`: a child with what it holds. */
function contentLabel(doc: Doc, el: El): string {
  const kids = kidsOf(el).map((k) => itemLabel(doc, k));
  const body = bodyOf(el);
  const inside = [...kids, ...(body !== undefined ? [`"${body.trim().length > 40 ? `${body.trim().slice(0, 37)}...` : body.trim()}"`] : [])];
  return `${itemLabel(doc, el)}${inside.length ? ` (${inside.join(', ')})` : ''}`;
}

/**
 * The old item with the new one's attributes, value and same-labelled children
 * laid over it: what to pass to keep the old content (a detached copy).
 */
function mergedCopy(doc: Doc, old: El, value: El): El {
  const props: Record<string, unknown> = { ...attrsOf(old), ...attrsOf(value) };
  const body = bodyOf(value) ?? bodyOf(old);
  if (body !== undefined) props['$body'] = body;
  const copy = doc.moddle.createAny(value.$type, (value.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? '', props) as unknown as El;
  const fresh = new Map(kidsOf(value).map((k) => [itemLabel(doc, k), k]));
  const kids: El[] = [];
  for (const k of kidsOf(old)) {
    const label = itemLabel(doc, k);
    kids.push(fresh.get(label) ?? k);
    fresh.delete(label);
  }
  kids.push(...fresh.values());
  if (kids.length) (copy as unknown as Raw)['$children'] = kids;
  return copy;
}

/** The type argument that files `value` where it was: its type, or the path from the top of extensionElements. */
function addTypeFor(doc: Doc, level: Level, value: El): string {
  if (!level.parent) return value.$type;
  const filed = is(level.parent.$parent as El | undefined, 'bpmn:ExtensionElements') && homeAt(typeOf(doc, value), undefined) === typeOf(doc, level.parent);
  return filed ? value.$type : `${pathOf(doc, level.parent)}/${value.$type}`;
}

/**
 * W_PROPERTY_DROPPED for a keyed item (`camunda:formField[id=amount]`) that
 * `ext add` replaced as a whole: the attributes, value and children the old
 * one had and the new one does not, and the command that keeps them.
 */
function keyedDrop(doc: Doc, level: Level, match: El[], value: El): Warning | undefined {
  const old = match[0]!;
  const lost: string[] = [];
  const now = attrsOf(value);
  for (const [k, v] of Object.entries(attrsOf(old))) if (now[k] === undefined) lost.push(`${k}="${v}"`);
  if (bodyOf(old) !== undefined && bodyOf(value) === undefined) lost.push(`its value "${bodyOf(old)!.trim().length > 40 ? `${bodyOf(old)!.trim().slice(0, 37)}...` : bodyOf(old)!.trim()}"`);
  const kept = new Set(kidsOf(value).map((k) => itemLabel(doc, k)));
  for (const k of kidsOf(old)) if (!kept.has(itemLabel(doc, k))) lost.push(contentLabel(doc, k));
  const extra = match.length - 1;
  if (extra) lost.push(`${extra} more ${itemLabel(doc, old)} with the same ${keyOf(doc, old)?.attr ?? 'key'}`);
  if (!lost.length) return undefined;
  const label = `${itemLabel(doc, value)}${level.parent ? ` in ${level.label}` : ''}`;
  const id = hostId(level.host);
  const snippet = extra ? undefined : snippetOf(mergedCopy(doc, old, value));
  const type = `${slotPrefix(level.host)}${addTypeFor(doc, level, value)}`;
  const quotedType = /^[\w.:-]+$/.test(type) ? type : `'${type}'`;
  return {
    code: 'W_PROPERTY_DROPPED',
    message: `${lost.join(', ')} of the replaced ${label} of ${hostLabel(level.host)} ${lost.length > 1 ? 'were' : 'was'} dropped: ext add replaces an item with the same ${keyOf(doc, value)?.attr ?? 'key'} as a whole`,
    element: id,
    hint:
      snippet && snippet.length <= SNIPPET_MAX
        ? `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '${snippet.replace(/'/g, "'\\''")}'\`.`
        : `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '<${value.$type} ...>...</${value.$type}>'\`.`,
  };
}

/** Merges a second single-instance element into the existing one. */
function merge(doc: Doc, level: Level, existing: El, incoming: El, notes: string[], drops: Warning[] = []): Outcome {
  const raw = existing as unknown as Raw;
  const changes: string[] = [];
  const have = attrsOf(existing);
  for (const [k, v] of Object.entries(attrsOf(incoming))) {
    if (have[k] === undefined) {
      raw[k] = v;
      changes.push(`${k}="${v}"`);
    }
  }
  const ib = bodyOf(incoming);
  if (ib !== undefined && bodyOf(existing) === undefined) {
    raw['$body'] = ib;
    changes.push('value');
  }
  const sub: Outcome[] = [];
  const inner = levelOf(doc, level.host, existing);
  for (const c of kidsOf(incoming)) insert(doc, inner, c, false, sub, notes, drops);
  for (const s of sub) changes.push(`${s.verb} ${s.text.replace(` in ${inner.label}`, '').replace(` to ${inner.label}`, '')}`);
  const where = level.parent ? ` in ${level.label}` : '';
  if (!changes.length) {
    notes.push(`${existing.$type}${where} of ${hostLabel(level.host)} already holds that content; nothing to add`);
    return { verb: 'unchanged', text: `${existing.$type}${where}` };
  }
  return { verb: 'merged', text: `${existing.$type}${where} (${changes.join(', ')})` };
}

/** The level the new element goes to: the top, or the vendor element a path names (created when missing and unambiguous). */
function parentLevel(doc: Doc, host: El, steps: Step[], out: Outcome[], notes: string[]): Level {
  let level = new Level(doc, host);
  for (const step of steps) {
    const hits = selectAt(doc, level, step);
    if (hits.length > 1) {
      throw modelError('E_AMBIGUOUS_EXTENSION', `${step.text} matches ${hits.length} elements of ${hostLabel(host)}; say which one`, {
        element: hostId(host),
        candidates: hits.map((h) => itemLabel(doc, h.el)),
        hint: `Use [attr=value] or [index] in the path, e.g. ${step.name}[0]/... (see \`bpmn ext list <file> ${hostId(host)} --json\`).`,
      });
    }
    if (hits.length === 1) {
      level = levelOf(doc, host, hits[0]!.el);
      continue;
    }
    const t = canonicalName(doc, step.name);
    if (step.attr !== undefined || step.index !== undefined || !creatable(t)) {
      const present = presentAt(doc, [level]);
      throw modelError('E_NO_EXTENSION', `${hostLabel(host)} has no ${step.text}${step.attr === undefined && step.index === undefined ? ' to add into' : ''}`, {
        element: hostId(host),
        candidates: present,
        hint: `Present at that level: ${present.join(', ') || 'nothing'}. ${creatable(t) ? 'Leave out the [..] to create the container.' : `Add the ${step.name} itself first (with its attributes), then add into it.`}`,
      });
    }
    const created = createGeneric(doc, host, step.name, {}, undefined, {}, level.parent !== undefined);
    checkInsert(doc, host, level.items(), level.type, created, false);
    insert(doc, level, created, false, out, notes);
    level = levelOf(doc, host, created);
  }
  return level;
}

function addExtension(doc: Doc, el: El, op: ExtOp): ChangeSet {
  const cs = new ChangeSet();
  assertCanHoldExtensions(el);
  const hasXml = op.xml !== undefined && op.xml.trim() !== '';
  if (hasXml && ((op.attrs && Object.keys(op.attrs).length) || (op.body !== undefined && op.body !== ''))) {
    throw usageError('--xml cannot be combined with attr=value or --body', { element: hostId(el), hint: 'Put everything into the XML snippet, or use <type> attr=value --body <text>.' });
  }
  if (!hasXml && !op.type) {
    throw usageError('ext add needs --type <prefix:localName> (with --attr key=value / --body) or --xml <snippet>', { element: hostId(el) });
  }
  const steps = op.type ? parseSelector(op.type, el) : [];
  const last = steps[steps.length - 1];
  const out: Outcome[] = [];
  const notes: string[] = [];
  // a path type puts the new elements inside a vendor element
  const nested = steps.length > 1;

  // build (and check) the new elements before anything in the document changes
  let values: El[];
  if (hasXml) {
    values = parseSnippet(doc, el, op.xml!, nested);
    if (last) {
      const wanted = canonicalName(doc, last.name);
      const wrong = values.filter((v) => typeOf(doc, v) !== wanted);
      if (wrong.length) {
        throw modelError('E_INVALID_VALUE', `The --xml snippet's root ${wrong.map((v) => `<${v.$type}>`).join(', ')} does not match the type ${last.name}`, {
          element: hostId(el),
          hint: `<type> names the snippet's root elements: \`bpmn ext add <file> ${hostId(el)} ${slotPrefix(el)}${wrong[0]!.$type} --xml ...\`. To add into a container, use a path type, e.g. camunda:inputOutput/camunda:inputParameter.`,
        });
      }
      for (const v of values) applyStepKey(v, last, el);
    }
  } else {
    const attrs = { ...(op.attrs ?? {}) };
    if (last!.index !== undefined) badSelector(op.type!, 'an [index] only selects existing elements; give the attributes as attr=value', el);
    if (last!.attr !== undefined) {
      if (attrs[last!.attr] !== undefined && attrs[last!.attr] !== last!.value) {
        throw modelError('E_INVALID_VALUE', `${last!.text} and ${last!.attr}=${attrs[last!.attr]} disagree`, { element: hostId(el) });
      }
      attrs[last!.attr] = last!.value!;
    }
    values = [createGeneric(doc, el, last!.name, attrs, op.body, {}, nested)];
  }

  const level = parentLevel(doc, el, steps.slice(0, -1), out, notes);
  const drops: Warning[] = [];
  for (const v of values) {
    checkInsert(doc, el, level.items(), level.type, v, !!op.replace);
    insert(doc, level, v, !!op.replace, out, notes, drops);
    misplacedWarning(doc, el, v, cs);
  }
  for (const w of drops) cs.warn(w);
  doc.invalidate();
  for (const n of notes) cs.note(n);
  if (out.some((o) => o.verb !== 'unchanged')) cs.change(changeOf(ownerOf(el), describeOutcomes(out.filter((o) => o.verb !== 'unchanged'), slotPrefix(el))));
  return cs;
}

/** `type[attr=value]` on the last step of an --xml add: the roots must carry that attribute value. */
function applyStepKey(v: El, step: Step, el: El): void {
  if (step.index !== undefined) badSelector(step.text, 'an [index] only selects existing elements', el);
  if (step.attr === undefined) return;
  const have = attrsOf(v)[step.attr];
  if (have !== undefined && have !== step.value) {
    throw modelError('E_INVALID_VALUE', `${step.text} and the snippet's ${step.attr}="${have}" disagree`, { element: hostId(el) });
  }
  (v as unknown as Raw)[step.attr] = step.value;
}

function describeOutcomes(out: Outcome[], prefix = ''): string {
  if (out.every((o) => o.verb === 'added')) return `ext added ${out.map((o) => prefix + o.text).join(', ')}`;
  return `ext ${out.map((o) => `${o.verb} ${prefix}${o.text}`).join('; ')}`;
}

/**
 * W_MISPLACED_EXTENSION for vendor content the engines never read where it was
 * put: loose camunda child types and fields, and zeebe elements the Zeebe
 * descriptor does not allow on the host (zeebe:taskDefinition on a user task).
 * In a Camunda 8 file the profile reports the zeebe case as
 * W_C8_MISPLACED_EXTENSION, which replaces this warning on a write.
 */
function misplacedWarning(doc: Doc, host: El, v: El, cs: ChangeSet): void {
  if (!v.$parent || v.$parent !== host.get<El | undefined>('extensionElements')) return;
  const t = typeOf(doc, v);
  if (t.startsWith('zeebe:')) {
    const local = t.slice('zeebe:'.length);
    const z = zeebeType(local);
    if (!z || zeebeAllowedOn(local, host) !== false) return;
    const hosts = z.allowedIn.filter((a) => a.startsWith('bpmn:')).map((a) => a.slice(5).replace(/^./, (c) => c.toLowerCase()));
    cs.warn(
      coversProfileSubjects(
        {
          code: 'W_MISPLACED_EXTENSION',
          message: `${v.$type} on ${hostLabel(host)} (${host.$type}) is not read by Camunda 8: it belongs on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')}`,
          element: hostId(host),
          hint: `Remove it (\`bpmn ext remove <file> ${hostId(host)} ${slotPrefix(host)}${v.$type}\`) and add it where it is read (\`bpmn kinds\` lists the zeebe elements per kind).`,
        },
        [`ext:${local}`],
      ),
    );
    return;
  }
  if (!isCamunda(t)) return;
  if (nestedOnly(t)) {
    const containers = containersOf(ruleName(t))
      .filter((c) => !c.endsWith('inputOutputParameter'))
      .map((c) => inFamily(c, t));
    cs.warn({
      code: 'W_MISPLACED_EXTENSION',
      message: `${v.$type} was added at the top level of the extensionElements of ${hostLabel(host)}, where the engines do not read it; it belongs inside ${containers.join(' / ')}`,
      element: hostId(host),
      hint: `Add it with a path to its container, e.g. \`bpmn ext add <file> ${hostId(host)} '${slotPrefix(host)}${familyPath(pathTo(ruleName(t), EXAMPLE_CONTAINER[ruleName(t)] ?? ruleName(containers[0]!)), t)}' ...\`, and remove the loose one with \`bpmn ext remove <file> ${hostId(host)} ${slotPrefix(host)}${v.$type}\`.`,
    });
    return;
  }
  if (ruleName(t) === 'camunda:field' && allowedOn(ruleName(t), host) === false) {
    cs.warn({
      code: 'W_MISPLACED_EXTENSION',
      message: `${v.$type} on ${hostLabel(host)} (${host.$type}) is not read by the engines: field injection belongs to service, send and business rule tasks, a message event definition or a listener`,
      element: hostId(host),
      hint: `Put it into a listener, e.g. \`bpmn ext add <file> ${hostId(host)} '${familyPath('camunda:executionListener[0]/camunda:field', t)}' name=... stringValue=...\`.`,
    });
  }
}

/** A path of camunda type names in the namespace family of `like` (hints for operaton content). */
function familyPath(path: string, like: string): string {
  return like.startsWith('operaton:') ? path.replace(/(^|[/'])camunda:/g, '$1operaton:') : path;
}

/** The container used in hints for types the descriptor allows in many places. */
const EXAMPLE_CONTAINER: Readonly<Record<string, string>> = {
  'camunda:value': 'camunda:formField',
  'camunda:script': 'camunda:executionListener',
  'camunda:list': 'camunda:inputParameter',
  'camunda:map': 'camunda:inputParameter',
};

/**
 * An example path from the top of extensionElements to `type` through
 * `container` (containers that are themselves nested only are walked up
 * until one sits in extensionElements, which the path then leaves out:
 * camunda:constraint -> 'camunda:formField[id=<id>]/camunda:validation/camunda:constraint').
 */
function pathTo(type: string, container: string): string {
  const chain = [type];
  let c: string | undefined = container;
  for (let i = 0; c && nestedOnly(c) && i < 6; i++) {
    chain.unshift(c);
    const up: string[] = containersOf(c).filter((x) => !x.endsWith('inputOutputParameter'));
    c = up.length === 1 ? up[0] : undefined;
  }
  if (c && !nestedOnly(c) && chain.length === 1) chain.unshift(c);
  return chain
    .map((t, i) => {
      const key = i < chain.length - 1 ? KEYS[t]?.[0] : undefined;
      return key ? `${t}[${key}=<${key}>]` : t;
    })
    .join('/');
}

/* ------------------------------------------------------------------ */
/* remove                                                               */
/* ------------------------------------------------------------------ */

function removeExtension(doc: Doc, el: El, op: ExtOp): ChangeSet {
  const cs = new ChangeSet();
  const container = el.get<El | undefined>('extensionElements');
  const list = container ? many(container, 'values') : [];
  const present = list.map((v) => v.$type);
  if (!list.length) {
    throw modelError('E_NO_EXTENSION', `${hostLabel(el)} has no extension elements`, { element: hostId(el), hint: 'Nothing to remove.' });
  }
  const top = new Level(doc, el);
  let victims: Array<{ el: El; level: Level }>;
  if (op.index !== undefined) {
    const v = list[op.index];
    if (!v) {
      throw modelError('E_NO_EXTENSION', `${hostLabel(el)} has no extension element at index ${op.index} (0..${list.length - 1})`, {
        element: hostId(el),
        hint: `Present: ${present.map((t, i) => `${i}: ${t}`).join(', ')}.`,
      });
    }
    victims = [{ el: v, level: top }];
  } else if (op.type) {
    victims = select(doc, el, top, parseSelector(op.type, el), op.type);
  } else {
    throw usageError('ext remove needs --type <prefix:localName> or --index <n>', { element: hostId(el) });
  }
  const texts: string[] = [];
  for (const { el: v, level } of victims) {
    level.remove(v);
    texts.push(`${itemLabel(doc, v)}${level.parent ? ` from ${level.label}` : ''}`);
    pruneEmpty(doc, el, level, cs);
  }
  const c = el.get<El | undefined>('extensionElements');
  if (c && !many(c, 'values').length) el.set('extensionElements', undefined);
  doc.invalidate();
  cs.change(changeOf(ownerOf(el), `ext removed ${texts.map((t) => slotPrefix(el) + t).join(', ')}`));
  return cs;
}

/** Resolves a remove selector to the elements to remove (E_NO_EXTENSION when nothing matches). */
function select(doc: Doc, host: El, top: Level, steps: Step[], text: string): Array<{ el: El; level: Level }> {
  let levels: Level[] = [top];
  let hits: Array<{ el: El; level: Level }> = [];
  for (const [i, step] of steps.entries()) {
    hits = levels.flatMap((lv) => selectAt(doc, lv, step));
    // legacy: a bare type also matches case-insensitively at the top level
    if (!hits.length && i === 0 && steps.length === 1 && step.attr === undefined && step.index === undefined) {
      hits = top
        .items()
        .filter((v) => v.$type.toLowerCase() === step.name.toLowerCase())
        .map((v) => ({ el: v, level: top }));
    }
    // a predicate names one item precisely: find it wherever it is (one place only)
    if (!hits.length && i === 0 && step.attr !== undefined) {
      hits = selectDeep(doc, top, step);
      const places = new Set(hits.map((h) => h.level.parent));
      if (places.size > 1) {
        throw modelError('E_AMBIGUOUS_EXTENSION', `${step.text} matches items in ${places.size} places of ${hostLabel(host)}; say which one`, {
          element: hostId(host),
          candidates: hits.map((h) => pathOf(doc, h.el)),
          hint: `Give the path, e.g. '${pathOf(doc, hits[0]!.el)}' (quote it in the shell).`,
        });
      }
    }
    if (!hits.length) {
      const present = presentAt(doc, levels.flatMap((lv) => [lv, ...lv.items().filter((e) => isGeneric(e)).map((e) => levelOf(doc, host, e))]));
      throw modelError('E_NO_EXTENSION', `${hostLabel(host)} has no ${steps.length > 1 ? `${step.text} (in ${text})` : `${step.text} extension element`}`, {
        element: hostId(host),
        candidates: present,
        hint: `Present: ${present.join(', ') || 'nothing'}. Select one item with [attr=value] or [index], e.g. '${present.find((p) => p.includes('[')) ?? 'camunda:inputParameter[name=x]'}' (quote it in the shell).`,
      });
    }
    levels = hits.map((h) => levelOf(doc, host, h.el));
  }
  return hits;
}

/** Removes containers left empty by a removal (camunda:inputOutput without parameters, ...), bottom up. */
function pruneEmpty(doc: Doc, host: El, level: Level, cs: ChangeSet): void {
  let cur: El | undefined = level.parent;
  while (cur && isGeneric(cur)) {
    if (kidsOf(cur).length || bodyOf(cur) !== undefined || Object.keys(attrsOf(cur)).length) return;
    if (!PURE_CONTAINERS.has(ruleName(typeOf(doc, cur)))) return;
    const parent = cur.$parent as El | undefined;
    if (!parent) return;
    if (is(parent, 'bpmn:ExtensionElements')) {
      removeFrom(parent, 'values', cur);
      cs.note(`removed the empty ${cur.$type} of ${hostLabel(host)}`);
      return;
    }
    new Level(doc, host, parent).remove(cur);
    cs.note(`removed the empty ${cur.$type} of ${hostLabel(host)}`);
    cur = parent;
  }
}

/* ------------------------------------------------------------------ */
/* list                                                                 */
/* ------------------------------------------------------------------ */

function describe(v: El): Omit<ExtensionInfo, 'index'> {
  const info: Omit<ExtensionInfo, 'index'> = { type: v.$type, attrs: {} };
  const d = descriptorOf(v);
  if (d.isGeneric) {
    const raw = v as unknown as Record<string, unknown>;
    for (const [k, val] of Object.entries(raw)) {
      if (k.startsWith('$') || val === undefined || val === null || typeof val === 'object' || typeof val === 'function') continue;
      info.attrs[k] = String(val);
    }
    if (typeof raw['$body'] === 'string') info.body = raw['$body'];
    const kids = (raw['$children'] as unknown[] | undefined)?.filter(isEl) ?? [];
    if (kids.length) info.children = kids.map(describe);
    return info;
  }
  for (const p of d.properties ?? []) {
    const val = (v as unknown as Record<string, unknown>)[p.name];
    if (val === undefined || val === null) continue;
    if (p.isBody && typeof val === 'string') info.body = val;
    else if (p.isAttr && typeof val !== 'object') info.attrs[p.name] = String(val);
  }
  return info;
}

/** The extension elements of an element, in order. */
export function listExtensions(el: El): ExtensionInfo[] {
  const container = el.get<El | undefined>('extensionElements');
  if (!container) return [];
  return many(container, 'values').map((v, index) => ({ index, ...describe(v) }));
}

/**
 * `ext list`: the element's own extension elements, then those of its nested
 * elements (event definition, loop characteristics, condition expression),
 * each with its slot (`ext remove <file> <id> loop.0`).
 */
export function listAllExtensions(el: El): ExtensionInfo[] {
  const out = listExtensions(el);
  for (const { prefix, el: nested } of nestedEntries(el)) out.push(...listExtensions(nested).map((i) => ({ ...i, slot: prefix })));
  return out;
}

/* ------------------------------------------------------------------ */
/* synchronous snippet parser                                           */
/* ------------------------------------------------------------------ */

interface RawNode {
  name: string;
  attrs: Record<string, string>;
  children: RawNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

class SnippetError extends Error {}

/** Minimal well-formed-XML reader for extension snippets (elements, attributes, text, CDATA, comments, PIs). */
function readXml(xml: string): RawNode[] {
  const roots: RawNode[] = [];
  const stack: RawNode[] = [];
  const nameRe = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
  const attrRe = /\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  const wsRe = /\s*/y;
  const push = (n: RawNode): void => {
    const top = stack[stack.length - 1];
    (top ? top.children : roots).push(n);
  };
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt);
    const top = stack[stack.length - 1];
    if (top) top.text += decodeEntities(text);
    else if (text.trim()) throw new SnippetError(`text "${text.trim().slice(0, 20)}" outside of an element`);
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new SnippetError('unterminated comment');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new SnippetError('unterminated CDATA section');
      if (!top) throw new SnippetError('CDATA outside of an element');
      top.text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) throw new SnippetError('unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw new SnippetError('declarations (<!DOCTYPE ...>) are not allowed in a snippet');
    if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw new SnippetError('unterminated closing tag');
      const name = xml.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new SnippetError(`unexpected closing tag </${name}>${open ? `, expected </${open.name}>` : ''}`);
      i = end + 1;
      continue;
    }
    nameRe.lastIndex = lt + 1;
    const nm = nameRe.exec(xml);
    if (!nm || nm.index !== lt + 1) throw new SnippetError(`invalid tag at offset ${lt}`);
    const node: RawNode = { name: nm[0], attrs: {}, children: [], text: '' };
    let j = nameRe.lastIndex;
    for (;;) {
      attrRe.lastIndex = j;
      const am = attrRe.exec(xml);
      if (am && am.index === j) {
        node.attrs[am[1]!] = decodeEntities(am[2] ?? am[3] ?? '');
        j = attrRe.lastIndex;
        continue;
      }
      wsRe.lastIndex = j;
      wsRe.exec(xml);
      j = wsRe.lastIndex;
      if (xml.startsWith('/>', j)) {
        push(node);
        i = j + 2;
        break;
      }
      if (xml[j] === '>') {
        push(node);
        stack.push(node);
        i = j + 1;
        break;
      }
      throw new SnippetError(`invalid attribute syntax in <${node.name}>`);
    }
  }
  const open = stack[stack.length - 1];
  if (open) throw new SnippetError(`unclosed element <${open.name}>`);
  return roots;
}

/** One parsed node as a generic element; `nested` = it sits inside a vendor element (bpmn: allowed there). */
function toAny(doc: Doc, el: El, node: RawNode, scope: Record<string, string>, nested: boolean): El {
  const local = { ...scope };
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'xmlns') throw modelError('E_INVALID_XML', `<${node.name}> declares a default namespace; extension elements must use a prefix`, { element: hostId(el) });
    if (k.startsWith('xmlns:')) local[k.slice(6)] = v;
    else attrs[k] = v;
  }
  const any = createGeneric(doc, el, node.name, attrs, node.text.trim() ? node.text : undefined, local, nested);
  const children = node.children.map((c) => toAny(doc, el, c, local, true));
  if (children.length) {
    (any as unknown as Raw)['$children'] = children;
    for (const c of children) c.$parent = any;
  }
  return any;
}

/**
 * Parses an extension snippet into generic moddle elements (E_INVALID_XML on
 * malformed input). `nested`: the roots go inside a vendor element (a path
 * type), so bpmn: roots are allowed.
 */
export function parseSnippet(doc: Doc, el: El, xml: string, nested = false): El[] {
  let roots: RawNode[];
  try {
    roots = readXml(xml);
  } catch (err) {
    if (err instanceof SnippetError) {
      throw modelError('E_INVALID_XML', `Cannot parse the extension snippet: ${err.message}`, {
        element: hostId(el),
        hint: 'Pass well-formed XML with prefixed elements, e.g. --xml \'<zeebe:ioMapping><zeebe:input source="=x" target="y"/></zeebe:ioMapping>\'.',
      });
    }
    throw err;
  }
  if (!roots.length) throw modelError('E_INVALID_XML', 'The extension snippet contains no elements', { element: hostId(el) });
  return roots.map((r) => toAny(doc, el, r, {}, nested));
}

/**
 * `ext`: vendor extension elements inside <bpmn:extensionElements>.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - add: op.type is `prefix:localName`; the namespace comes from the file's
 *    xmlns declarations or KNOWN_NAMESPACES (declareNamespace), else
 *    E_UNKNOWN_NAMESPACE. Creates moddle.createAny(type, uri, {attrs..., $body})
 *    and appends it to el.extensionElements.values (creating the container).
 *    op.replace removes existing values of the same type first.
 *  - op.xml: a raw snippet (may contain nested elements); every parsed
 *    element is appended (a parse error -> E_INVALID_XML).
 *    NOTE: bpmn-moddle's fromXML is asynchronous while ops run synchronously,
 *    so the snippet is parsed by the small synchronous XML reader below into
 *    exactly the generic elements moddle would create (same $type / attrs /
 *    $body / $children shape, verified against moddle's own parse).
 *  - remove: by type (all of that type) or by index; empty container is removed.
 *  - listExtensions(): [{index, type, attrs, body?, children?: [...]}] for
 *    `ext list` and for `show <id>`.
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { addTo, many, removeFrom, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { changeOf, descriptorOf, idOf, isEl } from './set.js';
import type { ExtOp } from './types.js';

export interface ExtensionInfo {
  index: number;
  type: string;
  attrs: Record<string, string>;
  body?: string;
  children?: Array<Omit<ExtensionInfo, 'index'>>;
}

const NAME_RE = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/;

/** Runs an `ext` operation (add / remove). */
export function extensionOp(doc: Doc, op: ExtOp): ChangeSet {
  const el = doc.require(op.id);
  if (op.action === 'add') return addExtension(doc, el, op);
  if (op.action === 'remove') return removeExtension(doc, el, op);
  throw usageError(`Unknown ext action "${String(op.action)}"; use add or remove`, { element: op.id });
}

/* ------------------------------------------------------------------ */
/* add                                                                  */
/* ------------------------------------------------------------------ */

function splitType(type: string, el: El): { prefix: string; local: string } {
  const m = NAME_RE.exec(type.trim());
  if (!m) {
    throw modelError('E_INVALID_VALUE', `"${type}" is not a prefixed element name (expected prefix:localName, e.g. zeebe:taskDefinition)`, { element: idOf(el) });
  }
  const prefix = m[1]!;
  if (prefix === 'bpmn' || prefix === 'xmlns') {
    throw modelError('E_INVALID_VALUE', `Extension elements must belong to a vendor namespace, not "${prefix}:"`, {
      element: idOf(el),
      hint: 'Use a vendor prefix such as zeebe: or camunda:.',
    });
  }
  return { prefix, local: m[2]! };
}

/** Resolves (and declares) the namespace of a prefix: snippet-local xmlns, file xmlns or the known list. */
function namespaceFor(doc: Doc, prefix: string, local: Record<string, string>): string {
  const inline = local[prefix];
  if (inline) {
    doc.declareNamespace(prefix, inline);
    return inline;
  }
  doc.declareNamespace(prefix);
  return doc.namespaceUri(prefix)!;
}

function createExtension(doc: Doc, el: El, type: string, attrs: Record<string, string>, body?: string): El {
  const { prefix } = splitType(type, el);
  const uri = namespaceFor(doc, prefix, {});
  for (const key of Object.keys(attrs)) {
    const m = NAME_RE.exec(key);
    if (m && m[1] !== 'xmlns') namespaceFor(doc, m[1]!, {});
  }
  const props: Record<string, unknown> = { ...attrs };
  if (body !== undefined && body !== '') props['$body'] = body;
  return doc.moddle.createAny(type.trim(), uri, props) as unknown as El;
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

function addExtension(doc: Doc, el: El, op: ExtOp): ChangeSet {
  const cs = new ChangeSet();
  let values: El[];
  if (op.xml !== undefined && op.xml.trim()) {
    values = parseSnippet(doc, el, op.xml);
  } else if (op.type) {
    values = [createExtension(doc, el, op.type, op.attrs ?? {}, op.body)];
  } else {
    throw usageError('ext add needs --type <prefix:localName> (with --attr key=value / --body) or --xml <snippet>', { element: idOf(el) });
  }
  const container = ensureContainer(doc, el);
  const list = many(container, 'values');
  if (op.replace) {
    const types = new Set(values.map((v) => v.$type));
    const existing = list.filter((v) => types.has(v.$type));
    for (const e of existing) removeFrom(container, 'values', e);
    if (existing.length) cs.note(`replaced ${existing.length} existing ${[...types].join(', ')}`);
  }
  addTo(container, 'values', ...values);
  doc.invalidate();
  cs.change(changeOf(el, `ext added ${values.map((v) => v.$type).join(', ')}`));
  return cs;
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
    throw modelError('E_NO_EXTENSION', `${idOf(el)} has no extension elements`, { element: idOf(el), hint: 'Nothing to remove.' });
  }
  let victims: El[];
  if (op.index !== undefined) {
    const v = list[op.index];
    if (!v) {
      throw modelError('E_NO_EXTENSION', `${idOf(el)} has no extension element at index ${op.index} (0..${list.length - 1})`, {
        element: idOf(el),
        hint: `Present: ${present.map((t, i) => `${i}: ${t}`).join(', ')}.`,
      });
    }
    victims = [v];
  } else if (op.type) {
    const wanted = op.type.trim();
    victims = list.filter((v) => v.$type === wanted);
    if (!victims.length) victims = list.filter((v) => v.$type.toLowerCase() === wanted.toLowerCase());
    if (!victims.length) {
      throw modelError('E_NO_EXTENSION', `${idOf(el)} has no ${wanted} extension element`, {
        element: idOf(el),
        candidates: [...new Set(present)],
        hint: `Present: ${present.join(', ')}.`,
      });
    }
  } else {
    throw usageError('ext remove needs --type <prefix:localName> or --index <n>', { element: idOf(el) });
  }
  for (const v of victims) removeFrom(container!, 'values', v);
  if (!list.length) el.set('extensionElements', undefined);
  doc.invalidate();
  cs.change(changeOf(el, `ext removed ${victims.map((v) => v.$type).join(', ')}`));
  return cs;
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

function toAny(doc: Doc, el: El, node: RawNode, scope: Record<string, string>): El {
  const local = { ...scope };
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'xmlns') throw modelError('E_INVALID_XML', `<${node.name}> declares a default namespace; extension elements must use a prefix`, { element: idOf(el) });
    if (k.startsWith('xmlns:')) local[k.slice(6)] = v;
    else attrs[k] = v;
  }
  const { prefix } = splitType(node.name, el);
  const uri = namespaceFor(doc, prefix, local);
  for (const key of Object.keys(attrs)) {
    const m = NAME_RE.exec(key);
    if (m && m[1] !== 'xmlns') namespaceFor(doc, m[1]!, local);
  }
  const children = node.children.map((c) => toAny(doc, el, c, local));
  const props: Record<string, unknown> = { ...attrs };
  if (node.text.trim()) props['$body'] = node.text;
  if (children.length) props['$children'] = children;
  const any = doc.moddle.createAny(node.name, uri, props) as unknown as El;
  for (const c of children) c.$parent = any;
  return any;
}

/** Parses an extension snippet into generic moddle elements (E_INVALID_XML on malformed input). */
export function parseSnippet(doc: Doc, el: El, xml: string): El[] {
  let roots: RawNode[];
  try {
    roots = readXml(xml);
  } catch (err) {
    if (err instanceof SnippetError) {
      throw modelError('E_INVALID_XML', `Cannot parse the extension snippet: ${err.message}`, {
        element: idOf(el),
        hint: 'Pass well-formed XML with prefixed elements, e.g. --xml \'<zeebe:ioMapping><zeebe:input source="=x" target="y"/></zeebe:ioMapping>\'.',
      });
    }
    throw err;
  }
  if (!roots.length) throw modelError('E_INVALID_XML', 'The extension snippet contains no elements', { element: idOf(el) });
  return roots.map((r) => toAny(doc, el, r, {}));
}

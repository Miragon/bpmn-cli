import type { Doc } from '../../document/Doc.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { type Warning } from '../../document/CliError.js';
import { is, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { coversProfileSubjects } from '../utils/covers.js';
import { familyPath, isCamunda, ruleName } from '../utils/vendor-family.js';
import { EXTENSION_STRUCTURE } from './ExtensionStructure.js';
import { ExtensionLevel } from './ExtensionLevel.js';
import { ExtensionSnippetReader } from './ExtensionSnippetReader.js';
import { NESTED_HOSTS } from '../NestedHosts.js';
import { SelectorParser, type Step } from './SelectorParser.js';
import { VendorElements } from '../VendorElements.js';
import type { EditExtensionElements } from '../../commands/types.js';
import { CAMUNDA } from '../../document/vendor/CamundaDescriptor.js';
import { ZEEBE } from '../../document/vendor/ZeebeDescriptor.js';

interface Outcome {
  verb: 'added' | 'replaced' | 'merged' | 'unchanged';
  text: string;
}

const SNIPPET_MAX = 800;

type Raw = Record<string, unknown>;

/**
 * `ext add`: inserts vendor extension elements by the structure rules: into their container,
 * keyed items replaced in place, single-instance types merged.
 */
export class ExtensionInserter {
  private readonly structure = EXTENSION_STRUCTURE;
  private readonly hosts = NESTED_HOSTS;
  private readonly names: VendorElements;
  private readonly selectors: SelectorParser;
  private readonly snippets: ExtensionSnippetReader;

  constructor(private readonly doc: Doc) {
    this.names = new VendorElements(doc, this.hosts);
    this.selectors = new SelectorParser(this.hosts);
    this.snippets = new ExtensionSnippetReader(this.names, this.hosts);
  }

  /** Adds extension values; they are built and checked before anything in the document changes. */
  add(el: El, op: EditExtensionElements): ChangeSet {
    const cs = new ChangeSet();
    this.assertCanHoldExtensions(el);
    const hasXml = op.xml !== undefined && op.xml.trim() !== '';
    if (hasXml && ((op.attrs && Object.keys(op.attrs).length) || (op.body !== undefined && op.body !== ''))) {
      throw usageError('--xml cannot be combined with attr=value or --body', { element: this.hosts.idOf(el), hint: 'Put everything into the XML snippet, or use <type> attr=value --body <text>.' });
    }
    if (!hasXml && !op.type) {
      throw usageError('ext add needs --type <prefix:localName> (with --attr key=value / --body) or --xml <snippet>', { element: this.hosts.idOf(el) });
    }
    const steps = op.type ? this.selectors.parse(op.type, el) : [];
    const last = steps[steps.length - 1];
    const out: Outcome[] = [];
    const notes: string[] = [];
    const nested = steps.length > 1;

    let values: El[];
    if (hasXml) {
      values = this.snippets.parse(el, op.xml!, nested);
      if (last) {
        const wanted = this.names.canonicalName(last.name);
        const wrong = values.filter((snippet) => this.names.typeOf(snippet) !== wanted);
        if (wrong.length) {
          throw modelError('E_INVALID_VALUE', `The --xml snippet's root ${wrong.map((snippet) => `<${snippet.$type}>`).join(', ')} does not match the type ${last.name}`, {
            element: this.hosts.idOf(el),
            hint: `<type> names the snippet's root elements: \`bpmn ext add <file> ${this.hosts.idOf(el)} ${this.hosts.slotPrefix(el)}${wrong[0]!.$type} --xml ...\`. To add into a container, use a path type, e.g. camunda:inputOutput/camunda:inputParameter.`,
          });
        }
        for (const snippet of values) this.applyStepKey(snippet, last, el);
      }
    } else {
      const attrs = { ...(op.attrs ?? {}) };
      if (last!.index !== undefined) this.selectors.fail(op.type!, 'an [index] only selects existing elements; give the attributes as attr=value', el);
      if (last!.attr !== undefined) {
        if (attrs[last!.attr] !== undefined && attrs[last!.attr] !== last!.value) {
          throw modelError('E_INVALID_VALUE', `${last!.text} and ${last!.attr}=${attrs[last!.attr]} disagree`, { element: this.hosts.idOf(el) });
        }
        attrs[last!.attr] = last!.value!;
      }
      values = [this.names.createGeneric(el, last!.name, attrs, op.body, {}, nested)];
    }

    const level = this.parentLevel(el, steps.slice(0, -1), out, notes);
    const drops: Warning[] = [];
    for (const snippet of values) {
      this.checkInsert(el, level.items(), level.type, snippet, !!op.replace);
      this.insert(level, snippet, !!op.replace, out, notes, drops);
      this.misplacedWarning(el, snippet, cs);
    }
    for (const warning of drops) cs.warn(warning);
    this.doc.invalidate();
    for (const note of notes) cs.note(note);
    if (out.some((outcome) => outcome.verb !== 'unchanged')) cs.change(ChangeSet.entryOf(this.hosts.ownerOf(el), this.describeOutcomes(out.filter((outcome) => outcome.verb !== 'unchanged'), this.hosts.slotPrefix(el))));
    return cs;
  }

  private assertCanHoldExtensions(el: El): void {
    if (is(el, 'bpmn:Definitions')) {
      throw modelError('E_WRONG_KIND', `${this.hosts.labelOf(el)} is the bpmn:definitions element, which cannot hold extension elements (BPMN 2.0 XSD; the engines reject such a file)`, {
        element: this.hosts.idOf(el),
        hint: 'Put process-level extensions on the process: `bpmn ext add <file> <processId> camunda:properties ...` (`bpmn show <file>` lists the process id).',
      });
    }
    if (!is(el, 'bpmn:BaseElement')) {
      throw modelError('E_WRONG_KIND', `${this.hosts.labelOf(el) || el.$type} (${el.$type}) cannot hold bpmn:extensionElements`, {
        element: this.hosts.idOf(el),
        hint: 'Extension elements belong to BPMN elements: processes, flow nodes, flows, event definitions, ...',
      });
    }
  }

  private duplicate(host: El, message: string, related?: string): never {
    throw modelError('E_DUPLICATE_EXTENSION', message, {
      element: this.hosts.idOf(host),
      hint: `Pass --replace to replace it as a whole${related ? ` (ext add <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${related} ... --replace)` : ''}, or remove the old one first with \`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}<selector>\` (see \`bpmn ext list\`).`,
    });
  }

  private checkInsert(host: El, items: El[], levelType: string | undefined, value: El, replace: boolean): void {
    const typeName = this.names.typeOf(value);
    const home = this.structure.homeAt(typeName, levelType);
    if (home) {
      const homes = items.filter((item) => this.names.typeOf(item) === home);
      if (homes.length > 1) this.duplicate(host, `${this.hosts.labelOf(host)} already has ${homes.length} ${homes[0]!.$type} elements; ${value.$type} cannot be placed unambiguously (the engines reject more than one)`, homes[0]!.$type);
      if (homes.length === 1) this.checkInsert(host, this.names.kidsOf(homes[0]!), home, value, replace);
      return;
    }
    if (replace || this.names.keyOf(value) || !this.structure.isSingle(typeName, levelType)) return;
    const same = items.filter((item) => this.names.typeOf(item) === typeName);
    if (same.length > 1) this.duplicate(host, `${this.hosts.labelOf(host)} already has ${same.length} ${same[0]!.$type} elements (only one is allowed); merging into them is ambiguous`, value.$type);
    if (same.length === 1) this.checkMerge(host, same[0]!, value);
  }

  private checkMerge(host: El, existing: El, incoming: El): void {
    const have = this.names.attrsOf(existing);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(incoming))) {
      if (have[attrName] !== undefined && have[attrName] !== attrValue) {
        this.duplicate(host, `${this.hosts.labelOf(host)} already has a ${existing.$type} with ${attrName}="${have[attrName]}"; the new one says ${attrName}="${attrValue}" (only one ${existing.$type} is allowed)`, incoming.$type);
      }
    }
    const hb = this.names.bodyOf(existing);
    const ib = this.names.bodyOf(incoming);
    if (hb !== undefined && ib !== undefined && hb.trim() !== ib.trim()) {
      this.duplicate(host, `${this.hosts.labelOf(host)} already has a ${existing.$type} with the value "${hb.trim()}"; the new one is "${ib.trim()}" (only one ${existing.$type} is allowed)`, incoming.$type);
    }
    if (!this.names.isGeneric(existing)) return;
    for (const kid of this.names.kidsOf(incoming)) this.checkInsert(host, this.names.kidsOf(existing), this.names.typeOf(existing), kid, false);
  }

  /** Inserts a value at its level; a missing container is written with the prefix the file binds to its namespace. */
  private insert(level: ExtensionLevel, value: El, replace: boolean, out: Outcome[], notes: string[], drops: Warning[] = []): void {
    const typeName = this.names.typeOf(value);
    const where = level.parent ? ` in ${level.label}` : '';
    const home = this.structure.homeAt(typeName, level.type);
    if (home) {
      let container = level.items().find((item) => this.names.typeOf(item) === home);
      if (!container) {
        const [prefix, local] = home.split(':') as [string, string];
        const uri = this.names.canonicalUri(prefix);
        const ns = this.names.resolvePrefix(level.host, prefix, uri ? { [prefix]: uri } : {});
        container = this.doc.moddle.createAny(`${ns.prefix}:${local}`, ns.uri, {}) as unknown as El;
        level.append(container);
        notes.push(`created ${container.$type}${where} for ${value.$type}`);
      }
      this.insert(level.inside(container), value, replace, out, notes, drops);
      return;
    }
    const into = level.parent ? ` to ${level.label}` : '';
    const same = level.items().filter((item) => this.names.typeOf(item) === typeName);
    const key = this.names.keyOf(value);
    if (key) {
      const match = same.filter((item) => this.names.attrsOf(item)[key.attr] === key.value);
      if (match.length) {
        if (!replace) {
          const drop = this.keyedDrop(level, match, value);
          if (drop) drops.push(drop);
        }
        level.replace(match[0]!, value);
        for (const extra of match.slice(1)) level.remove(extra);
        out.push({ verb: 'replaced', text: `${this.names.itemLabel(value)}${level.parent ? ` in ${level.label}` : ''}` });
        notes.push(`replaced the existing ${this.names.itemLabel(value)}${level.parent ? ` in ${level.label}` : ''} of ${this.hosts.labelOf(level.host)}`);
        return;
      }
      level.append(value);
      out.push({ verb: 'added', text: `${this.names.itemLabel(value)}${into}` });
      return;
    }
    if (replace && same.length) {
      for (const item of same) level.remove(item);
      level.append(value);
      out.push({ verb: 'replaced', text: `${value.$type}${level.parent ? ` in ${level.label}` : ''}` });
      notes.push(`replaced ${same.length} existing ${value.$type}`);
      return;
    }
    if (same.length === 1 && this.structure.isSingle(typeName, level.type)) {
      out.push(this.merge(level, same[0]!, value, notes, drops));
      return;
    }
    level.append(value);
    out.push({ verb: 'added', text: `${this.names.itemLabel(value)}${into}` });
  }

  private escapeXml(text: string, attr: boolean): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return attr ? escaped.replace(/"/g, '&quot;') : escaped;
  }

  private snippetOf(el: El): string | undefined {
    if (!this.names.isGeneric(el)) return undefined;
    const attrs = Object.entries(this.names.attrsOf(el))
      .map(([attrName, attrValue]) => ` ${attrName}="${this.escapeXml(attrValue, true)}"`)
      .join('');
    const kids = this.names.kidsOf(el).map((kid) => this.snippetOf(kid));
    if (kids.some((kidSnippet) => kidSnippet === undefined)) return undefined;
    const body = (el as unknown as Raw)['$body'];
    const text = typeof body === 'string' ? this.escapeXml(body, false) : '';
    if (!kids.length && !text) return `<${el.$type}${attrs} />`;
    return `<${el.$type}${attrs}>${text}${kids.join('')}</${el.$type}>`;
  }

  private contentLabel(el: El): string {
    const kids = this.names.kidsOf(el).map((kid) => this.names.itemLabel(kid));
    const body = this.names.bodyOf(el);
    const inside = [...kids, ...(body !== undefined ? [`"${body.trim().length > 40 ? `${body.trim().slice(0, 37)}...` : body.trim()}"`] : [])];
    return `${this.names.itemLabel(el)}${inside.length ? ` (${inside.join(', ')})` : ''}`;
  }

  /** The old item with the new one laid over it: what to pass to keep the old content. */
  private mergedCopy(old: El, value: El): El {
    const props: Record<string, unknown> = { ...this.names.attrsOf(old), ...this.names.attrsOf(value) };
    const body = this.names.bodyOf(value) ?? this.names.bodyOf(old);
    if (body !== undefined) props['$body'] = body;
    const copy = this.doc.moddle.createAny(value.$type, (value.$descriptor as { ns?: { uri?: string } }).ns?.uri ?? '', props) as unknown as El;
    const fresh = new Map(this.names.kidsOf(value).map((kid) => [this.names.itemLabel(kid), kid]));
    const kids: El[] = [];
    for (const kid of this.names.kidsOf(old)) {
      const label = this.names.itemLabel(kid);
      kids.push(fresh.get(label) ?? kid);
      fresh.delete(label);
    }
    kids.push(...fresh.values());
    if (kids.length) (copy as unknown as Raw)['$children'] = kids;
    return copy;
  }

  private addTypeFor(level: ExtensionLevel, value: El): string {
    if (!level.parent) return value.$type;
    const filed = is(level.parent.$parent as El | undefined, 'bpmn:ExtensionElements') && this.structure.homeAt(this.names.typeOf(value), undefined) === this.names.typeOf(level.parent);
    return filed ? value.$type : `${this.names.pathOf(level.parent)}/${value.$type}`;
  }

  private keyedDrop(level: ExtensionLevel, match: El[], value: El): Warning | undefined {
    const old = match[0]!;
    const lost: string[] = [];
    const now = this.names.attrsOf(value);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(old))) if (now[attrName] === undefined) lost.push(`${attrName}="${attrValue}"`);
    if (this.names.bodyOf(old) !== undefined && this.names.bodyOf(value) === undefined) lost.push(`its value "${this.names.bodyOf(old)!.trim().length > 40 ? `${this.names.bodyOf(old)!.trim().slice(0, 37)}...` : this.names.bodyOf(old)!.trim()}"`);
    const kept = new Set(this.names.kidsOf(value).map((kid) => this.names.itemLabel(kid)));
    for (const kid of this.names.kidsOf(old)) if (!kept.has(this.names.itemLabel(kid))) lost.push(this.contentLabel(kid));
    const extra = match.length - 1;
    if (extra) lost.push(`${extra} more ${this.names.itemLabel(old)} with the same ${this.names.keyOf(old)?.attr ?? 'key'}`);
    if (!lost.length) return undefined;
    const label = `${this.names.itemLabel(value)}${level.parent ? ` in ${level.label}` : ''}`;
    const id = this.hosts.idOf(level.host);
    const snippet = extra ? undefined : this.snippetOf(this.mergedCopy(old, value));
    const type = `${this.hosts.slotPrefix(level.host)}${this.addTypeFor(level, value)}`;
    const quotedType = /^[\w.:-]+$/.test(type) ? type : `'${type}'`;
    return {
      code: 'W_PROPERTY_DROPPED',
      message: `${lost.join(', ')} of the replaced ${label} of ${this.hosts.labelOf(level.host)} ${lost.length > 1 ? 'were' : 'was'} dropped: ext add replaces an item with the same ${this.names.keyOf(value)?.attr ?? 'key'} as a whole`,
      element: id,
      hint:
        snippet && snippet.length <= SNIPPET_MAX
          ? `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '${snippet.replace(/'/g, "'\\''")}'\`.`
          : `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '<${value.$type} ...>...</${value.$type}>'\`.`,
    };
  }

  private merge(level: ExtensionLevel, existing: El, incoming: El, notes: string[], drops: Warning[] = []): Outcome {
    const raw = existing as unknown as Raw;
    const changes: string[] = [];
    const have = this.names.attrsOf(existing);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(incoming))) {
      if (have[attrName] === undefined) {
        raw[attrName] = attrValue;
        changes.push(`${attrName}="${attrValue}"`);
      }
    }
    const ib = this.names.bodyOf(incoming);
    if (ib !== undefined && this.names.bodyOf(existing) === undefined) {
      raw['$body'] = ib;
      changes.push('value');
    }
    const sub: Outcome[] = [];
    const inner = level.inside(existing);
    for (const kid of this.names.kidsOf(incoming)) this.insert(inner, kid, false, sub, notes, drops);
    for (const subOutcome of sub) changes.push(`${subOutcome.verb} ${subOutcome.text.replace(` in ${inner.label}`, '').replace(` to ${inner.label}`, '')}`);
    const where = level.parent ? ` in ${level.label}` : '';
    if (!changes.length) {
      notes.push(`${existing.$type}${where} of ${this.hosts.labelOf(level.host)} already holds that content; nothing to add`);
      return { verb: 'unchanged', text: `${existing.$type}${where}` };
    }
    return { verb: 'merged', text: `${existing.$type}${where} (${changes.join(', ')})` };
  }

  /** A missing vendor element a path names is created when unambiguous. */
  private parentLevel(host: El, steps: Step[], out: Outcome[], notes: string[]): ExtensionLevel {
    let level = new ExtensionLevel(this.doc, this.names, host);
    for (const step of steps) {
      const hits = level.select(step);
      if (hits.length > 1) {
        throw modelError('E_AMBIGUOUS_EXTENSION', `${step.text} matches ${hits.length} elements of ${this.hosts.labelOf(host)}; say which one`, {
          element: this.hosts.idOf(host),
          candidates: hits.map((hit) => this.names.itemLabel(hit.el)),
          hint: `Use [attr=value] or [index] in the path, e.g. ${step.name}[0]/... (see \`bpmn ext list <file> ${this.hosts.idOf(host)} --json\`).`,
        });
      }
      if (hits.length === 1) {
        level = level.inside(hits[0]!.el);
        continue;
      }
      const typeName = this.names.canonicalName(step.name);
      if (step.attr !== undefined || step.index !== undefined || !this.structure.creatable(typeName)) {
        const present = ExtensionLevel.present([level]);
        throw modelError('E_NO_EXTENSION', `${this.hosts.labelOf(host)} has no ${step.text}${step.attr === undefined && step.index === undefined ? ' to add into' : ''}`, {
          element: this.hosts.idOf(host),
          candidates: present,
          hint: `Present at that level: ${present.join(', ') || 'nothing'}. ${this.structure.creatable(typeName) ? 'Leave out the [..] to create the container.' : `Add the ${step.name} itself first (with its attributes), then add into it.`}`,
        });
      }
      const created = this.names.createGeneric(host, step.name, {}, undefined, {}, level.parent !== undefined);
      this.checkInsert(host, level.items(), level.type, created, false);
      this.insert(level, created, false, out, notes);
      level = level.inside(created);
    }
    return level;
  }

  private applyStepKey(snippet: El, step: Step, el: El): void {
    if (step.index !== undefined) this.selectors.fail(step.text, 'an [index] only selects existing elements', el);
    if (step.attr === undefined) return;
    const have = this.names.attrsOf(snippet)[step.attr];
    if (have !== undefined && have !== step.value) {
      throw modelError('E_INVALID_VALUE', `${step.text} and the snippet's ${step.attr}="${have}" disagree`, { element: this.hosts.idOf(el) });
    }
    (snippet as unknown as Raw)[step.attr] = step.value;
  }

  private describeOutcomes(out: Outcome[], prefix = ''): string {
    if (out.every((outcome) => outcome.verb === 'added')) return `ext added ${out.map((outcome) => prefix + outcome.text).join(', ')}`;
    return `ext ${out.map((outcome) => `${outcome.verb} ${prefix}${outcome.text}`).join('; ')}`;
  }

  /**
   * Vendor content the engines never read where it was put. In a Camunda 8 file the profile's
   * W_C8_MISPLACED_EXTENSION replaces this warning for zeebe elements.
   */
  private misplacedWarning(host: El, snippet: El, cs: ChangeSet): void {
    if (!snippet.$parent || snippet.$parent !== host.get<El | undefined>('extensionElements')) return;
    const typeName = this.names.typeOf(snippet);
    if (typeName.startsWith('zeebe:')) {
      const local = typeName.slice('zeebe:'.length);
      const zeebeType = ZEEBE.type(local);
      if (!zeebeType || ZEEBE.allowedOn(local, host) !== false) return;
      const hosts = zeebeType.allowedIn.filter((allowedType) => allowedType.startsWith('bpmn:')).map((allowedType) => allowedType.slice(5).replace(/^./, (firstChar) => firstChar.toLowerCase()));
      cs.warn(
        coversProfileSubjects(
          {
            code: 'W_MISPLACED_EXTENSION',
            message: `${snippet.$type} on ${this.hosts.labelOf(host)} (${host.$type}) is not read by Camunda 8: it belongs on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')}`,
            element: this.hosts.idOf(host),
            hint: `Remove it (\`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${snippet.$type}\`) and add it where it is read (\`bpmn kinds\` lists the zeebe elements per kind).`,
          },
          [`ext:${local}`],
        ),
      );
      return;
    }
    if (!isCamunda(typeName)) return;
    if (this.structure.nestedOnly(typeName)) {
      const containers = this.structure.containersOf(typeName);
      cs.warn({
        code: 'W_MISPLACED_EXTENSION',
        message: `${snippet.$type} was added at the top level of the extensionElements of ${this.hosts.labelOf(host)}, where the engines do not read it; it belongs inside ${containers.join(' / ')}`,
        element: this.hosts.idOf(host),
        hint: `Add it with a path to its container, e.g. \`bpmn ext add <file> ${this.hosts.idOf(host)} '${this.hosts.slotPrefix(host)}${familyPath(this.structure.examplePath(typeName, containers), typeName)}' ...\`, and remove the loose one with \`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${snippet.$type}\`.`,
      });
      return;
    }
    if (ruleName(typeName) === 'camunda:field' && CAMUNDA.allowedOn(ruleName(typeName), host) === false) {
      cs.warn({
        code: 'W_MISPLACED_EXTENSION',
        message: `${snippet.$type} on ${this.hosts.labelOf(host)} (${host.$type}) is not read by the engines: field injection belongs to service, send and business rule tasks, a message event definition or a listener`,
        element: this.hosts.idOf(host),
        hint: `Put it into a listener, e.g. \`bpmn ext add <file> ${this.hosts.idOf(host)} '${familyPath('camunda:executionListener[0]/camunda:field', typeName)}' name=... stringValue=...\`.`,
      });
    }
  }
}

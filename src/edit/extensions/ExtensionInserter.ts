import { type BpmnDocument, type BpmnElement, BpmnError, ChangeEntries, ChangeSet, type Finding } from '../../model/index.js';
import type { ExtOperation } from '../../operations/index.js';
import { ExtensionChecks } from './ExtensionChecks.js';
import { ExtensionLevel } from './ExtensionLevel.js';
import { ExtensionSnippetReader } from './ExtensionSnippetReader.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import { NestedHosts } from './NestedHosts.js';
import { ReplacedItem } from './ReplacedItem.js';
import { SelectorParser, type Step } from './SelectorParser.js';
import { VendorElements } from './VendorElements.js';

interface Outcome {
  verb: 'added' | 'replaced' | 'merged' | 'unchanged';
  text: string;
}

export class ExtensionInserter {
  private readonly structure = ExtensionStructure.INSTANCE;
  private readonly hosts = NestedHosts.INSTANCE;
  private readonly names: VendorElements;
  private readonly selectors: SelectorParser;
  private readonly snippets: ExtensionSnippetReader;
  private readonly checks: ExtensionChecks;

  constructor(private readonly document: BpmnDocument) {
    this.names = new VendorElements(document, this.hosts);
    this.selectors = new SelectorParser(this.hosts);
    this.snippets = new ExtensionSnippetReader(this.names, this.hosts);
    this.checks = new ExtensionChecks(this.names);
  }

  add(el: BpmnElement, command: ExtOperation): ChangeSet {
    const changes = new ChangeSet();
    this.checks.assertCanHoldExtensions(el);
    const hasXml = command.xml !== undefined && command.xml.trim() !== '';
    if (!hasXml && !command.type) {
      throw BpmnError.usage('ext add needs a type <prefix:localName> (with key=value / body=<text>) or --xml <snippet>', { element: this.hosts.idOf(el) });
    }
    const steps = command.type ? this.selectors.parse(command.type, el) : [];
    const out: Outcome[] = [];
    const notes: string[] = [];
    const values = hasXml ? this.snippetValues(el, command.xml!, steps) : [this.typedValue(el, command, steps)];
    const level = this.parentLevel(el, steps.slice(0, -1), out, notes);
    const drops: Finding[] = [];
    for (const snippet of values) {
      this.checks.checkInsert(el, level.items(), level.type, snippet, !!command.replace);
      this.insert(level, snippet, !!command.replace, out, notes, drops);
      this.checks.warnMisplaced(el, snippet, changes);
    }
    for (const warning of drops) {
      changes.warn(warning);
    }
    this.document.tree.invalidate();
    for (const note of notes) {
      changes.note(note);
    }
    const effective = out.filter((outcome) => outcome.verb !== 'unchanged');
    if (effective.length) {
      changes.change(ChangeEntries.of(this.hosts.ownerOf(el), this.describeOutcomes(effective, this.hosts.slotPrefix(el))));
    }
    return changes;
  }

  private snippetValues(el: BpmnElement, xml: string, steps: Step[]): BpmnElement[] {
    const last = steps[steps.length - 1];
    const values = this.snippets.parse(el, xml, steps.length > 1);
    if (!last) {
      return values;
    }
    const wanted = this.names.canonicalName(last.name);
    const wrong = values.filter((snippet) => this.names.typeOf(snippet) !== wanted);
    if (wrong.length) {
      throw BpmnError.model('E_INVALID_VALUE', `The --xml snippet's root ${wrong.map((snippet) => `<${snippet.type}>`).join(', ')} does not match the type ${last.name}`, {
        element: this.hosts.idOf(el),
        hint: `<type> names the snippet's root elements: \`bpmn ext add <file> ${this.hosts.idOf(el)} ${this.hosts.slotPrefix(el)}${wrong[0]!.type} --xml ...\`. To add into a container, use a path type, e.g. camunda:inputOutput/camunda:inputParameter.`,
      });
    }
    for (const snippet of values) {
      this.applyStepKey(snippet, last, el);
    }
    return values;
  }

  private typedValue(el: BpmnElement, command: ExtOperation, steps: Step[]): BpmnElement {
    const last = steps[steps.length - 1]!;
    const attrs = { ...(command.attrs ?? {}) };
    if (last.index !== undefined) {
      this.selectors.fail(command.type!, 'an [index] only selects existing elements; give the attributes as attr=value', el);
    }
    if (last.attr !== undefined) {
      if (attrs[last.attr] !== undefined && attrs[last.attr] !== last.value) {
        throw BpmnError.model('E_INVALID_VALUE', `${last.text} and ${last.attr}=${attrs[last.attr]} disagree`, { element: this.hosts.idOf(el) });
      }
      attrs[last.attr] = last.value!;
    }
    return this.names.createGeneric(el, last.name, attrs, command.body, {}, steps.length > 1);
  }

  private insert(level: ExtensionLevel, value: BpmnElement, replace: boolean, out: Outcome[], notes: string[], drops: Finding[] = []): void {
    const typeName = this.names.typeOf(value);
    const home = this.structure.homeAt(typeName, level.type);
    if (home) {
      this.insert(level.enter(this.homeContainer(level, home, value, notes)), value, replace, out, notes, drops);
      return;
    }
    const same = level.items().filter((item) => this.names.typeOf(item) === typeName);
    const key = this.names.keyOf(value);
    if (key) {
      const match = same.filter((item) => this.names.attrsOf(item)[key.attr] === key.value);
      if (match.length) {
        this.replaceKeyed(level, match, value, replace, out, notes, drops);
      } else {
        this.appendNew(level, value, out);
      }
      return;
    }
    if (replace && same.length) {
      this.replaceSame(level, same, value, out, notes);
      return;
    }
    if (same.length === 1 && this.structure.isSingle(typeName, level.type)) {
      out.push(this.merge(level, same[0]!, value, notes, drops));
      return;
    }
    this.appendNew(level, value, out);
  }

  private homeContainer(level: ExtensionLevel, home: string, value: BpmnElement, notes: string[]): BpmnElement {
    const present = level.items().find((item) => this.names.typeOf(item) === home);
    if (present) {
      return present;
    }
    const [prefix, local] = home.split(':') as [string, string];
    const uri = this.names.canonicalUri(prefix);
    const ns = this.names.resolvePrefix(level.host, prefix, uri ? { [prefix]: uri } : {});
    const container = this.document.tree.buildAny(`${ns.prefix}:${local}`, ns.uri, {});
    level.append(container);
    notes.push(`created ${container.type}${level.where} for ${value.type}`);
    return container;
  }

  private replaceKeyed(level: ExtensionLevel, match: BpmnElement[], value: BpmnElement, replace: boolean, out: Outcome[], notes: string[], drops: Finding[]): void {
    if (!replace) {
      const drop = new ReplacedItem(this.document, this.names).droppedContent(level, match, value);
      if (drop) {
        drops.push(drop);
      }
    }
    level.replace(match[0]!, value);
    for (const extra of match.slice(1)) {
      level.remove(extra);
    }
    out.push({ verb: 'replaced', text: `${this.names.itemLabel(value)}${level.where}` });
    notes.push(`replaced the existing ${this.names.itemLabel(value)}${level.where} of ${this.hosts.labelOf(level.host)}`);
  }

  private replaceSame(level: ExtensionLevel, same: BpmnElement[], value: BpmnElement, out: Outcome[], notes: string[]): void {
    for (const item of same) {
      level.remove(item);
    }
    level.append(value);
    out.push({ verb: 'replaced', text: `${value.type}${level.where}` });
    notes.push(`replaced ${same.length} existing ${value.type}`);
  }

  private appendNew(level: ExtensionLevel, value: BpmnElement, out: Outcome[]): void {
    const into = level.parent ? ` to ${level.label}` : '';
    level.append(value);
    out.push({ verb: 'added', text: `${this.names.itemLabel(value)}${into}` });
  }

  private merge(level: ExtensionLevel, existing: BpmnElement, incoming: BpmnElement, notes: string[], drops: Finding[]): Outcome {
    const changes = this.mergeOwnContent(existing, incoming);
    const sub: Outcome[] = [];
    const inner = level.enter(existing);
    for (const kid of this.names.kidsOf(incoming)) {
      this.insert(inner, kid, false, sub, notes, drops);
    }
    for (const subOutcome of sub) {
      changes.push(`${subOutcome.verb} ${subOutcome.text.replace(` in ${inner.label}`, '').replace(` to ${inner.label}`, '')}`);
    }
    if (!changes.length) {
      notes.push(`${existing.type}${level.where} of ${this.hosts.labelOf(level.host)} already holds that content; nothing to add`);
      return { verb: 'unchanged', text: `${existing.type}${level.where}` };
    }
    return { verb: 'merged', text: `${existing.type}${level.where} (${changes.join(', ')})` };
  }

  private mergeOwnContent(existing: BpmnElement, incoming: BpmnElement): string[] {
    const changes: string[] = [];
    const have = this.names.attrsOf(existing);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(incoming))) {
      if (have[attrName] === undefined) {
        existing.set(attrName, attrValue);
        changes.push(`${attrName}="${attrValue}"`);
      }
    }
    const ib = this.names.bodyOf(incoming);
    if (ib !== undefined && this.names.bodyOf(existing) === undefined) {
      existing.set('$body', ib);
      changes.push('value');
    }
    return changes;
  }

  private parentLevel(host: BpmnElement, steps: Step[], out: Outcome[], notes: string[]): ExtensionLevel {
    let level = new ExtensionLevel(this.document, this.names, host);
    for (const step of steps) {
      const hits = level.select(step);
      if (hits.length > 1) {
        throw BpmnError.model('E_AMBIGUOUS_EXTENSION', `${step.text} matches ${hits.length} elements of ${this.hosts.labelOf(host)}; say which one`, {
          element: this.hosts.idOf(host),
          candidates: hits.map((hit) => this.names.itemLabel(hit.el)),
          hint: `Use [attr=value] or [index] in the path, e.g. ${step.name}[0]/... (see \`bpmn show <file> ${this.hosts.idOf(host)}\`).`,
        });
      }
      level = level.enter(hits.length === 1 ? hits[0]!.el : this.createContainer(host, level, step, out, notes));
    }
    return level;
  }

  private createContainer(host: BpmnElement, level: ExtensionLevel, step: Step, out: Outcome[], notes: string[]): BpmnElement {
    this.assertCreatable(host, level, step);
    const created = this.names.createGeneric(host, step.name, {}, undefined, {}, level.parent !== undefined);
    this.checks.checkInsert(host, level.items(), level.type, created, false);
    this.insert(level, created, false, out, notes);
    return created;
  }

  private assertCreatable(host: BpmnElement, level: ExtensionLevel, step: Step): void {
    const creatable = this.structure.isCreatable(this.names.canonicalName(step.name));
    if (step.attr === undefined && step.index === undefined && creatable) {
      return;
    }
    const present = ExtensionLevel.present([level]);
    throw BpmnError.model('E_NO_EXTENSION', `${this.hosts.labelOf(host)} has no ${step.text}${step.attr === undefined && step.index === undefined ? ' to add into' : ''}`, {
      element: this.hosts.idOf(host),
      candidates: present,
      hint: `Present at that level: ${present.join(', ') || 'nothing'}. ${creatable ? 'Leave out the [..] to create the container.' : `Add the ${step.name} itself first (with its attributes), then add into it.`}`,
    });
  }

  private applyStepKey(snippet: BpmnElement, step: Step, el: BpmnElement): void {
    if (step.index !== undefined) {
      this.selectors.fail(step.text, 'an [index] only selects existing elements', el);
    }
    if (step.attr === undefined) {
      return;
    }
    const have = this.names.attrsOf(snippet)[step.attr];
    if (have !== undefined && have !== step.value) {
      throw BpmnError.model('E_INVALID_VALUE', `${step.text} and the snippet's ${step.attr}="${have}" disagree`, { element: this.hosts.idOf(el) });
    }
    snippet.set(step.attr, step.value);
  }

  private describeOutcomes(out: Outcome[], prefix: string): string {
    if (out.every((outcome) => outcome.verb === 'added')) {
      return `ext added ${out.map((outcome) => prefix + outcome.text).join(', ')}`;
    }
    return `ext ${out.map((outcome) => `${outcome.verb} ${prefix}${outcome.text}`).join('; ')}`;
  }
}

import { type BpmnDocument, type BpmnElement, BpmnError, ChangeEntries, ChangeSet } from '../../model/index.js';
import type { ExtOperation } from '../../operations/index.js';
import { ExtensionLevel } from './ExtensionLevel.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import { NestedHosts } from './NestedHosts.js';
import { SelectorParser, type Step } from './SelectorParser.js';
import { VendorElements } from './VendorElements.js';

interface Selection {
  el: BpmnElement;
  level: ExtensionLevel;
}

export class ExtensionRemover {
  private readonly structure = ExtensionStructure.INSTANCE;
  private readonly hosts = NestedHosts.INSTANCE;
  private readonly names: VendorElements;
  private readonly selectors: SelectorParser;

  constructor(private readonly document: BpmnDocument) {
    this.names = new VendorElements(document, this.hosts);
    this.selectors = new SelectorParser(this.hosts);
  }

  remove(el: BpmnElement, command: ExtOperation): ChangeSet {
    const changes = new ChangeSet();
    const container = el.get<BpmnElement | undefined>('extensionElements');
    const list = container ? container.list('values') : [];
    const present = list.map((value) => value.type);
    if (!list.length) {
      throw BpmnError.model('E_NO_EXTENSION', `${this.hosts.labelOf(el)} has no extension elements`, { element: this.hosts.idOf(el), hint: 'Nothing to remove.' });
    }
    const top = new ExtensionLevel(this.document, this.names, el);
    let victims: Selection[];
    if (command.index !== undefined) {
      const victim = list[command.index];
      if (!victim) {
        throw BpmnError.model('E_NO_EXTENSION', `${this.hosts.labelOf(el)} has no extension element at index ${command.index} (0..${list.length - 1})`, {
          element: this.hosts.idOf(el),
          hint: `Present: ${present.map((typeName, index) => `${index}: ${typeName}`).join(', ')}.`,
        });
      }
      victims = [{ el: victim, level: top }];
    } else if (command.type) {
      victims = this.select(el, top, this.selectors.parse(command.type, el), command.type);
    } else {
      throw BpmnError.usage('ext remove needs --type <prefix:localName> or --index <n>', { element: this.hosts.idOf(el) });
    }
    const texts: string[] = [];
    for (const { el: victim, level } of victims) {
      level.remove(victim);
      texts.push(`${this.names.itemLabel(victim)}${level.parent ? ` from ${level.label}` : ''}`);
      this.pruneEmpty(el, level, changes);
    }
    const extensionElements = el.get<BpmnElement | undefined>('extensionElements');
    if (extensionElements && !extensionElements.list('values').length) {
      el.set('extensionElements', undefined);
    }
    this.document.tree.invalidate();
    changes.change(ChangeEntries.of(this.hosts.ownerOf(el), `ext removed ${texts.map((text) => this.hosts.slotPrefix(el) + text).join(', ')}`));
    return changes;
  }

  private select(host: BpmnElement, top: ExtensionLevel, steps: Step[], text: string): Selection[] {
    let levels: ExtensionLevel[] = [top];
    let hits: Selection[] = [];
    for (const [stepIndex, step] of steps.entries()) {
      hits = levels.flatMap((lv) => lv.select(step));
      if (!hits.length && stepIndex === 0) {
        hits = this.firstStepFallback(host, top, step, steps.length === 1);
      }
      if (!hits.length) {
        this.failNoHit(host, levels, step, steps, text);
      }
      levels = hits.map((hit) => hit.level.enter(hit.el));
    }
    return hits;
  }

  private firstStepFallback(host: BpmnElement, top: ExtensionLevel, step: Step, onlyStep: boolean): Selection[] {
    const hits =
      onlyStep && step.attr === undefined && step.index === undefined
        ? top
            .items()
            .filter((value) => value.type.toLowerCase() === step.name.toLowerCase())
            .map((value) => ({ el: value, level: top }))
        : [];
    if (hits.length || step.attr === undefined) {
      return hits;
    }
    const deep = top.selectDeep(step);
    const places = new Set(deep.map((hit) => hit.level.parent));
    if (places.size > 1) {
      throw BpmnError.model('E_AMBIGUOUS_EXTENSION', `${step.text} matches items in ${places.size} places of ${this.hosts.labelOf(host)}; say which one`, {
        element: this.hosts.idOf(host),
        candidates: deep.map((hit) => this.names.pathOf(hit.el)),
        hint: `Give the path, e.g. '${this.names.pathOf(deep[0]!.el)}' (quote it in the shell).`,
      });
    }
    return deep;
  }

  private failNoHit(host: BpmnElement, levels: ExtensionLevel[], step: Step, steps: Step[], text: string): never {
    const present = ExtensionLevel.present(levels.flatMap((lv) => [lv, ...lv.items().filter((item) => this.names.isGeneric(item)).map((item) => lv.enter(item))]));
    throw BpmnError.model('E_NO_EXTENSION', `${this.hosts.labelOf(host)} has no ${steps.length > 1 ? `${step.text} (in ${text})` : `${step.text} extension element`}`, {
      element: this.hosts.idOf(host),
      candidates: present,
      hint: `Present: ${present.join(', ') || 'nothing'}. Select one item with [attr=value] or [index], e.g. '${present.find((label) => label.includes('[')) ?? 'camunda:inputParameter[name=x]'}' (quote it in the shell).`,
    });
  }

  private pruneEmpty(host: BpmnElement, level: ExtensionLevel, changes: ChangeSet): void {
    let cur: BpmnElement | undefined = level.parent;
    while (cur && this.names.isGeneric(cur)) {
      if (this.names.kidsOf(cur).length || this.names.bodyOf(cur) !== undefined || Object.keys(this.names.attrsOf(cur)).length || !this.structure.isPureContainer(this.names.typeOf(cur))) {
        return;
      }
      const parent: BpmnElement = cur.parent!;
      if (parent.is('bpmn:ExtensionElements')) {
        parent.remove('values', cur);
      } else {
        level.enter(parent).remove(cur);
      }
      changes.note(`removed the empty ${cur.type} of ${this.hosts.labelOf(host)}`);
      cur = parent;
    }
  }
}

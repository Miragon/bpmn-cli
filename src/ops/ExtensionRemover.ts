import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { is, many, removeFrom, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { changeOf } from './set.js';
import { EXTENSION_STRUCTURE } from './ExtensionStructure.js';
import { ExtensionLevel } from './ExtensionLevel.js';
import { NESTED_HOSTS } from './NestedHosts.js';
import { SelectorParser, type Step } from './SelectorParser.js';
import { VendorElements } from './VendorElements.js';
import type { ExtOp } from './types.js';

export class ExtensionRemover {
  private readonly structure = EXTENSION_STRUCTURE;
  private readonly hosts = NESTED_HOSTS;
  private readonly names: VendorElements;
  private readonly selectors: SelectorParser;

  constructor(private readonly doc: Doc) {
    this.names = new VendorElements(doc, this.hosts);
    this.selectors = new SelectorParser(this.hosts);
  }

  remove(el: El, op: ExtOp): ChangeSet {
    const cs = new ChangeSet();
    const container = el.get<El | undefined>('extensionElements');
    const list = container ? many(container, 'values') : [];
    const present = list.map((v) => v.$type);
    if (!list.length) {
      throw modelError('E_NO_EXTENSION', `${this.hosts.labelOf(el)} has no extension elements`, { element: this.hosts.idOf(el), hint: 'Nothing to remove.' });
    }
    const top = new ExtensionLevel(this.doc, this.names, el);
    let victims: Array<{ el: El; level: ExtensionLevel }>;
    if (op.index !== undefined) {
      const v = list[op.index];
      if (!v) {
        throw modelError('E_NO_EXTENSION', `${this.hosts.labelOf(el)} has no extension element at index ${op.index} (0..${list.length - 1})`, {
          element: this.hosts.idOf(el),
          hint: `Present: ${present.map((t, i) => `${i}: ${t}`).join(', ')}.`,
        });
      }
      victims = [{ el: v, level: top }];
    } else if (op.type) {
      victims = this.select(el, top, this.selectors.parse(op.type, el), op.type);
    } else {
      throw usageError('ext remove needs --type <prefix:localName> or --index <n>', { element: this.hosts.idOf(el) });
    }
    const texts: string[] = [];
    for (const { el: v, level } of victims) {
      level.remove(v);
      texts.push(`${this.names.itemLabel(v)}${level.parent ? ` from ${level.label}` : ''}`);
      this.pruneEmpty(el, level, cs);
    }
    const c = el.get<El | undefined>('extensionElements');
    if (c && !many(c, 'values').length) el.set('extensionElements', undefined);
    this.doc.invalidate();
    cs.change(changeOf(this.hosts.ownerOf(el), `ext removed ${texts.map((t) => this.hosts.slotPrefix(el) + t).join(', ')}`));
    return cs;
  }

  /** Resolves a remove selector to the elements to remove (E_NO_EXTENSION when nothing matches). */
  private select(host: El, top: ExtensionLevel, steps: Step[], text: string): Array<{ el: El; level: ExtensionLevel }> {
    let levels: ExtensionLevel[] = [top];
    let hits: Array<{ el: El; level: ExtensionLevel }> = [];
    for (const [i, step] of steps.entries()) {
      hits = levels.flatMap((lv) => lv.select(step));
      // legacy: a bare type also matches case-insensitively at the top level
      if (!hits.length && i === 0 && steps.length === 1 && step.attr === undefined && step.index === undefined) {
        hits = top
          .items()
          .filter((v) => v.$type.toLowerCase() === step.name.toLowerCase())
          .map((v) => ({ el: v, level: top }));
      }
      // a predicate names one item precisely: find it wherever it is (one place only)
      if (!hits.length && i === 0 && step.attr !== undefined) {
        hits = top.selectDeep(step);
        const places = new Set(hits.map((h) => h.level.parent));
        if (places.size > 1) {
          throw modelError('E_AMBIGUOUS_EXTENSION', `${step.text} matches items in ${places.size} places of ${this.hosts.labelOf(host)}; say which one`, {
            element: this.hosts.idOf(host),
            candidates: hits.map((h) => this.names.pathOf(h.el)),
            hint: `Give the path, e.g. '${this.names.pathOf(hits[0]!.el)}' (quote it in the shell).`,
          });
        }
      }
      if (!hits.length) {
        const present = ExtensionLevel.present(levels.flatMap((lv) => [lv, ...lv.items().filter((e) => this.names.isGeneric(e)).map((e) => lv.inside(e))]));
        throw modelError('E_NO_EXTENSION', `${this.hosts.labelOf(host)} has no ${steps.length > 1 ? `${step.text} (in ${text})` : `${step.text} extension element`}`, {
          element: this.hosts.idOf(host),
          candidates: present,
          hint: `Present: ${present.join(', ') || 'nothing'}. Select one item with [attr=value] or [index], e.g. '${present.find((p) => p.includes('[')) ?? 'camunda:inputParameter[name=x]'}' (quote it in the shell).`,
        });
      }
      levels = hits.map((h) => h.level.inside(h.el));
    }
    return hits;
  }

  /** Removes containers left empty by a removal (camunda:inputOutput without parameters, ...), bottom up. */
  private pruneEmpty(host: El, level: ExtensionLevel, cs: ChangeSet): void {
    let cur: El | undefined = level.parent;
    while (cur && this.names.isGeneric(cur)) {
      if (this.names.kidsOf(cur).length || this.names.bodyOf(cur) !== undefined || Object.keys(this.names.attrsOf(cur)).length) return;
      if (!this.structure.isPureContainer(this.names.typeOf(cur))) return;
      const parent = cur.$parent as El | undefined;
      if (!parent) return;
      if (is(parent, 'bpmn:ExtensionElements')) {
        removeFrom(parent, 'values', cur);
        cs.note(`removed the empty ${cur.$type} of ${this.hosts.labelOf(host)}`);
        return;
      }
      level.inside(parent).remove(cur);
      cs.note(`removed the empty ${cur.$type} of ${this.hosts.labelOf(host)}`);
      cur = parent;
    }
  }
}

import type { Doc } from '../model/Doc.js';
import type { FormerEnd } from '../model/EditContext.js';
import { followDiIds } from '../drawing/utils/di-ids.js';
import { connectionRequest, type IdRequest } from '../ids/utils/requests.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { speakingStem } from '../ids/utils/id-words.js';
import { hasIdWords, slugify } from '../ids/utils/slug.js';
import { is, many, type El, idOf } from '../model/utils/moddle.js';

/**
 * Keeps speaking flow ids (Flow_CheckInvoiceToDone) true: a flow named after its ends is
 * renamed after its new ends when they change. Other ids stay; with `--keep-flow-ids`
 * the document's flows keep theirs and get reported as stale.
 */
export class FlowIdFollower {
  constructor(private readonly doc: Doc) {}

  /**
   * Call before `set` renames `node`: a flow still named after its old id or name
   * follows (or is reported) when a later op of the batch changes its ends.
   */
  recordFormerEnd(node: El): void {
    if (!is(node, 'bpmn:FlowNode') || !(many(node, 'incoming').length || many(node, 'outgoing').length)) return;
    this.doc.edit.recordFormerEnd(node, { id: idOf(node), labels: this.endLabels(node) });
  }

  /**
   * Whether `id` is one any id style (also of earlier versions, with a collision suffix)
   * gives a flow between `source` and `target`, by their current or former names and ids.
   */
  namesEnds(id: string | undefined, source: El, target: El): boolean {
    if (!id) return false;
    const names = (el: El): FormerEnd[] => [{ id: idOf(el), labels: this.endLabels(el) }, ...this.doc.edit.formerEndsOf(el)];
    const targets = names(target);
    return names(source).some((s) =>
      targets.some((t) => s.labels.some((a) => t.labels.some((b) => this.doc.edit.allocator.isDerived(id, connectionRequest('bpmn:SequenceFlow', s.id, t.id, { sourceLabel: a, targetLabel: b }))))),
    );
  }

  /**
   * Returns the old id when it renamed the flow, `''` when it gave an id-less flow one.
   * With ids kept, a flow the batch created is nobody's API yet and still follows.
   */
  follow(flow: El, oldSource: El | undefined, oldTarget: El | undefined, wanted?: string): string | undefined {
    const doc = this.doc;
    if (!is(flow, 'bpmn:SequenceFlow') || !oldSource || !oldTarget) return undefined;
    const source = flow.get<El | undefined>('sourceRef');
    const target = flow.get<El | undefined>('targetRef');
    if (!source || !target || (source === oldSource && target === oldTarget)) return undefined;
    const old = idOf(flow);
    if (!old) {
      flow.set('id', doc.edit.allocator.explicitOr(wanted, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)));
      doc.invalidate();
      return '';
    }
    if (!this.namesEnds(old, oldSource, oldTarget)) return undefined;
    const oldIds = [idOf(oldSource), idOf(oldTarget)] as const;
    if (doc.edit.keepsFlowId(flow)) {
      doc.edit.recordKeptFlow(flow, `${oldIds[0]} -> ${oldIds[1]}`);
      return undefined;
    }
    doc.ids.release(old);
    const id = doc.edit.allocator.allocate(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)).id;
    if (id === old) return undefined;
    flow.set('id', id);
    doc.edit.recordRename(old, id, `${oldIds[0]} -> ${oldIds[1]}`, flow);
    this.followEdgeId(flow, old, id);
    return old;
  }

  /**
   * Flows at `node` whose id this batch generated from their ends: nobody's API yet, so
   * they follow when `node` gets another id. Call it before the rename.
   */
  namedAfter(node: El): El[] {
    const doc = this.doc;
    const flows = new Set([...many(node, 'incoming'), ...many(node, 'outgoing')]);
    for (const root of many(doc.definitions, 'rootElements')) {
      if (!is(root, 'bpmn:Collaboration')) continue;
      for (const f of many(root, 'messageFlows')) if (f.get<El | undefined>('sourceRef') === node || f.get<El | undefined>('targetRef') === node) flows.add(f);
    }
    return [...flows].filter((f) => !!f.get<El | undefined>('sourceRef') && !!f.get<El | undefined>('targetRef') && doc.edit.allocator.generatedFrom(idOf(f), FlowIdFollower.connectionRequestOf(f)));
  }

  /** `was`: the ends before the rename (`A -> B`). */
  followRenamedEnd(flow: El, was: string): void {
    const doc = this.doc;
    const old = idOf(flow);
    const req = FlowIdFollower.connectionRequestOf(flow);
    if (doc.edit.allocator.generatedFrom(old, req)) return;
    doc.ids.release(old);
    const id = doc.edit.allocator.allocate(req).id;
    if (id === old) return;
    flow.set('id', id);
    doc.edit.recordRegenerated(old, id, was, flow);
    this.followEdgeId(flow, old, id);
  }

  /**
   * Its label now, the speaking part of its id (renamed since), its name where the id
   * speaks too, and how earlier versions named an unnamed end.
   */
  private endLabels(el: El): string[] {
    const labels = [new ElementLabels(el).label(), speakingStem(idOf(el)), ...new ElementLabels(el).formerLabels()].filter((l): l is string => !!l);
    const name = el.get<string | undefined>('name');
    if (hasIdWords(name) && !labels.some((l) => l === name || (!l.includes('_') && slugify(l) === slugify(name)))) labels.push(name!);
    return [...new Set(labels)];
  }

  private followEdgeId(flow: El, old: string, id: string): void {
    followDiIds(this.doc.definitions, flow, old, id, this.doc.ids);
    this.doc.invalidate();
  }

  private static connectionRequestOf(flow: El): IdRequest {
    return ElementLabels.flowRequest(flow.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
  }
}

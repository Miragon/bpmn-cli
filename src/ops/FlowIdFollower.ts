/**
 * Speaking flow ids stay true: a flow whose id is the one the file's id
 * style gives a flow between its old ends (Flow_CheckInvoiceToDone, also
 * with a collision suffix: namesEnds) is renamed after its new ends when a
 * splice, a bridge, a move or `set source= / target=` changes them
 * (follow; its DI edge id follows when it was `<id>_di`, `BPMNEdge_<id>`
 * or `Edge_<id>`, also cut: diagram/write.ts followDiIds, which `set id=`
 * uses too). Every other id stays. With EditContext.followFlowEnds false
 * (`--keep-flow-ids`, where flow ids are API) a flow the document had keeps
 * its id, and the batch reports each one whose id no longer names its ends
 * (W_FLOW_ID_STALE, StaleFlowReport). An end `set` gave another id or
 * name earlier in the batch (or the op on its own) is recognised by what it
 * was called too (EditContext.recordFormerEnd), and by its name also where its id
 * speaks. A flow without id (valid BPMN, rare in files) whose ends change
 * gets an id from its new ends.
 */
import type { Doc } from '../model/Doc.js';
import type { FormerEnd } from '../model/EditContext.js';
import { followDiIds } from '../diagram/write.js';
import { connectionRequest, type IdRequest } from '../ids/utils/requests.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { speakingStem } from '../ids/utils/id-words.js';
import { hasIdWords, slugify } from '../ids/utils/slug.js';
import { is, many, type El, idOf } from '../model/utils/moddle.js';

export class FlowIdFollower {
  constructor(private readonly doc: Doc) {}

  /**
   * Records what `node` is called as a flow end before `set` gives it another
   * id or name (EditContext.recordFormerEnd): a flow whose id named it so
   * is still renamed, or with ids kept reported, when a later op of the batch
   * changes its ends. Only a node with sequence flows.
   */
  recordFormerEnd(node: El): void {
    if (!is(node, 'bpmn:FlowNode') || !(many(node, 'incoming').length || many(node, 'outgoing').length)) return;
    this.doc.edit.recordFormerEnd(node, { id: idOf(node), labels: this.endLabels(node) });
  }

  /**
   * Whether `id` is the id the file's style gives a sequence flow between
   * `source` and `target` (or the one any other flow prefix or form of the
   * file's flows gives it: also the `named` one earlier versions gave it, and
   * one under a prefix a tie outvoted), or such an id with a collision
   * suffix: the ends named by their names or (an end renamed since) by their
   * ids, also as earlier versions named an unnamed end (by its kind:
   * Flow_CheckToGateway), before the length cap and as 0.6 cut it
   * (IdAllocator.isDerived, given `id`: only the styles it can be of); an end
   * `set` renamed or named earlier in the batch also as it was called then
   * (its id and labels, EditContext.formerEndsOf). False for a flow without id. The
   * one test behind a rename (follow) and a stale id (StaleFlowReport).
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
   * Renames a flow whose id named its old ends (namesEnds) after its new
   * ends, together with a DI edge id derived from it; returns the old id when
   * it renamed the flow. A flow with any other id keeps it. With ids kept
   * (EditContext.followFlowEnds false) a flow the document had before the batch or the
   * op on its own (EditContext.flowsBefore) keeps its id too and is recorded for
   * W_FLOW_ID_STALE (StaleFlowReport); one the batch created is nobody's API
   * yet and still follows its ends. A flow without id gets one in both modes
   * (its change entry and the layout name it by it): `wanted`, the id an op
   * asked for it (`add --flow-id` on a splice: the flow into the new node;
   * claimed like the id of a flow add creates), else one from its new ends;
   * returns `''` (renamedNote: `id added`).
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
   * The sequence and message flows at `node` whose id the batch (or the op on
   * its own) generated from their ends as they are now (IdAllocator.generatedFrom): nobody's API yet, so they follow when the batch
   * gives `node` another id (IdRenamer.recordState; followRenamedEnd).
   * Call it before the rename.
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

  /**
   * Renames a flow namedAfter found after its ends, once one of them
   * took another id (the regenerated id of an element the batch created and
   * retyped, IdRenamer.recordState): the id its ends give now (a taken
   * one with a suffix, W_ID_SUFFIXED), its DI edge id with it; `was`: the
   * ends before (`A -> B`). None where its ends give the id it has.
   */
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
   * The labels a flow id may name an end by (namesEnds): how ids name it
   * now (ElementLabels.label), the speaking part of its id (an end renamed since), its
   * name also where its id speaks (Activity_Verify, named Check, after `set
   * id=`; left out where it gives the same words as one of the others), and
   * how earlier versions named an unnamed end (ElementLabels.formerLabels).
   */
  private endLabels(el: El): string[] {
    const labels = [new ElementLabels(el).label(), speakingStem(idOf(el)), ...new ElementLabels(el).formerLabels()].filter((l): l is string => !!l);
    const name = el.get<string | undefined>('name');
    if (hasIdWords(name) && !labels.some((l) => l === name || (!l.includes('_') && slugify(l) === slugify(name)))) labels.push(name!);
    return [...new Set(labels)];
  }

  /** The DI edge of a flow renamed `old` -> `id` follows where its id was derived from the flow's (`<id>_di`, `BPMNEdge_<id>`, `Edge_<id>`; diagram/write.ts followDiIds). */
  private followEdgeId(flow: El, old: string, id: string): void {
    followDiIds(this.doc.definitions, flow, old, id, this.doc.ids);
    this.doc.invalidate();
  }

  /** The request a connection's id is built from (its type, its ends). */
  private static connectionRequestOf(flow: El): IdRequest {
    return ElementLabels.flowRequest(flow.$type as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
  }
}

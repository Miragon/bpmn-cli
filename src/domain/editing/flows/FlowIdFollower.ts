import type { Doc } from '../../document/Doc.js';
import type { EditContext, FormerEnd } from '../../document/EditContext.js';
import { followDiIds } from '../../diagram/utils/di-ids.js';
import { connectionRequest, type IdRequest } from '../../document/utils/requests.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { speakingStem } from '../../document/utils/id-words.js';
import { hasIdWords, slugify } from '../../document/utils/slug.js';
import { is, many, type El, idOf } from '../../document/utils/moddle.js';

/**
 * Keeps speaking flow ids (Flow_CheckInvoiceToDone) true: a flow named after its ends is
 * renamed after its new ends when they change. Other ids stay; with `--keep-flow-ids`
 * the document's flows keep theirs and get reported as stale.
 */
export class FlowIdFollower {
  constructor(
    private readonly doc: Doc,
    private readonly edit: EditContext,
  ) {}

  /**
   * Call before `set` renames `node`: a flow still named after its old id or name
   * follows (or is reported) when a later op of the batch changes its ends.
   */
  recordFormerEnd(node: El): void {
    if (!is(node, 'bpmn:FlowNode') || !(many(node, 'incoming').length || many(node, 'outgoing').length)) return;
    this.edit.recordFormerEnd(node, { id: idOf(node), labels: this.endLabels(node) });
  }

  /**
   * Whether `id` is one any id style (also of earlier versions, with a collision suffix)
   * gives a flow between `source` and `target`, by their current or former names and ids.
   */
  namesEnds(id: string | undefined, source: El, target: El): boolean {
    if (!id) return false;
    const names = (el: El): FormerEnd[] => [{ id: idOf(el), labels: this.endLabels(el) }, ...this.edit.formerEndsOf(el)];
    const targets = names(target);
    return names(source).some((sourceName) =>
      targets.some((targetName) => sourceName.labels.some((sourceLabel) => targetName.labels.some((targetLabel) => this.edit.allocator.isDerived(id, connectionRequest('bpmn:SequenceFlow', sourceName.id, targetName.id, { sourceLabel, targetLabel }))))),
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
      flow.set('id', this.edit.allocator.explicitOr(wanted, ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)));
      doc.invalidate();
      return '';
    }
    if (!this.namesEnds(old, oldSource, oldTarget)) return undefined;
    const oldIds = [idOf(oldSource), idOf(oldTarget)] as const;
    if (this.edit.keepsFlowId(flow)) {
      this.edit.recordKeptFlow(flow, `${oldIds[0]} -> ${oldIds[1]}`);
      return undefined;
    }
    doc.ids.release(old);
    const id = this.edit.allocator.allocate(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target)).id;
    if (id === old) return undefined;
    flow.set('id', id);
    this.edit.recordRename(old, id, `${oldIds[0]} -> ${oldIds[1]}`, flow);
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
      for (const flow of many(root, 'messageFlows')) if (flow.get<El | undefined>('sourceRef') === node || flow.get<El | undefined>('targetRef') === node) flows.add(flow);
    }
    return [...flows].filter((flow) => !!flow.get<El | undefined>('sourceRef') && !!flow.get<El | undefined>('targetRef') && this.edit.allocator.generatedFrom(idOf(flow), FlowIdFollower.connectionRequestOf(flow)));
  }

  /** `was`: the ends before the rename (`A -> B`). */
  followRenamedEnd(flow: El, was: string): void {
    const doc = this.doc;
    const old = idOf(flow);
    const req = FlowIdFollower.connectionRequestOf(flow);
    if (this.edit.allocator.generatedFrom(old, req)) return;
    doc.ids.release(old);
    const id = this.edit.allocator.allocate(req).id;
    if (id === old) return;
    flow.set('id', id);
    this.edit.recordRegenerated(old, id, was, flow);
    this.followEdgeId(flow, old, id);
  }

  /**
   * Its label now, the speaking part of its id (renamed since), its name where the id
   * speaks too, and how earlier versions named an unnamed end.
   */
  private endLabels(el: El): string[] {
    const labels = [new ElementLabels(el).label(), speakingStem(idOf(el)), ...new ElementLabels(el).formerLabels()].filter((label): label is string => !!label);
    const name = el.get<string | undefined>('name');
    if (hasIdWords(name) && !labels.some((label) => label === name || (!label.includes('_') && slugify(label) === slugify(name)))) labels.push(name!);
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

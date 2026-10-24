/**
 * W_FLOW_ID_STALE: with flow ids kept (EditContext.followFlowEnds false),
 * every flow FlowIdFollower.follow kept whose id no longer names its ends,
 * once per batch (OpRunner), against the batch's final state.
 */
import type { Doc } from '../model/Doc.js';
import type { FlowEnds, KeptFlow } from '../model/EditContext.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { type Warning } from '../shared/CliError.js';
import { ElementLabels } from '../ids/ElementLabels.js';
import { isValidId } from '../ids/utils/slug.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import { type El, idOf } from '../model/utils/moddle.js';
import { FlowIdFollower } from './FlowIdFollower.js';

export class StaleFlowReport {
  constructor(private readonly doc: Doc) {}

  /**
   * The hint of add's W_OPTION_IGNORED for `--flow-id <flowId>` on a splice,
   * whose flow into the node is the existing `entry`: the command that renames
   * it; `deferred` (with ids kept, a splice that kept the flow,
   * EditContext.preferFlowId): that its W_FLOW_ID_STALE names the command, one for the
   * flow (report puts the command back where none comes).
   */
  static flowIdIgnoredHint(flowId: string, entry: string | undefined, deferred = false): string {
    const rename = !entry ? '' : deferred ? `; W_FLOW_ID_STALE names the command that renames ${entry}` : `; rename the existing one with \`bpmn set <file> ${entry} id=${flowId}\``;
    return `--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node)${rename}.`;
  }

  /**
   * W_FLOW_ID_STALE on `cs` for every flow kept since the last call whose id
   * no longer names its ends (`before`: the flows and their ends when the
   * batch began, EditContext.flowsBefore). Each hint's id is kept from the
   * later ones, so two flows that now run between the same ends get the id
   * and the `_2` the default rename gives them, and following every hint
   * never collides.
   */
  report(cs: ChangeSet, before?: ReadonlyMap<El, FlowEnds>): void {
    const kept = this.doc.edit.takeKeptFlows();
    if (!kept.size) return;
    const hinted = new IdRegistry(this.doc.ids.values());
    for (const [flow, was] of kept) {
      const warning = this.warningFor(flow, was, hinted, before?.get(flow));
      if (warning) cs.warn(warning);
      else if (was.preferred) this.restoreFlowIdHints(cs, flow, was.id);
    }
  }

  /**
   * W_FLOW_ID_STALE for a flow FlowIdFollower.follow kept whose id named its ends `was`
   * (`A -> B`): undefined when the flow is gone, its id names its ends again
   * (a later op restored them), it ends where it did when the batch began
   * (`began`: it was stale before, this change did not make it so) or the
   * batch renamed it since (`set id=`: the id it chose). The hint names the id
   * its ends give now, or the id an op wanted for it while it still ends where
   * that op put it (`add --flow-id` on a splice: KeptFlow.preferred, a valid
   * id that is free), which the document does not claim: renaming it is the
   * human's call, together with the code that uses the id. `hinted`: the
   * document's ids and those of the hints before; the hint's id is free there
   * and is added.
   */
  private warningFor(flow: El, { was, id: keptId, preferred }: KeptFlow, hinted: IdRegistry, began?: FlowEnds): Warning | undefined {
    const doc = this.doc;
    const id = idOf(flow);
    const source = flow.get<El | undefined>('sourceRef');
    const target = flow.get<El | undefined>('targetRef');
    if (id !== keptId || doc.get(id) !== flow || !source || !target || new FlowIdFollower(doc).namesEnds(id, source, target)) return undefined;
    if (began?.[0] === source && began[1] === target) return undefined;
    const wanted = preferred?.target === target && isValidId(preferred.id) && !hinted.has(preferred.id) && !doc.has(preferred.id) ? preferred.id : undefined;
    const suggested = wanted ?? doc.idStyle.next(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target), hinted).id;
    hinted.claim(suggested);
    return {
      code: 'W_FLOW_ID_STALE',
      message: `Flow ${id} kept its id, which names its old ends ${was}; it now runs ${idOf(source)} -> ${idOf(target)}`,
      element: id,
      related: [idOf(source), idOf(target)],
      hint: `Code and tests that use the id keep working; to rename it together with them: \`bpmn set <file> ${id} id=${suggested}\`.`,
    };
  }

  /**
   * A kept flow `id` gets no W_FLOW_ID_STALE (its id still names its ends, a
   * later op put it back or renamed it): the W_OPTION_IGNORED hints that
   * deferred to it (flowIdIgnoredHint) name the command that renames it
   * again, while the flow still has that id and the --flow-id is free, else
   * none.
   */
  private restoreFlowIdHints(cs: ChangeSet, flow: El, id: string): void {
    cs.warnings = cs.warnings.map((w) => {
      const flowId = w.code === 'W_OPTION_IGNORED' ? /^--flow-id (\S+) ignored/.exec(w.message)?.[1] : undefined;
      if (!flowId || w.hint !== StaleFlowReport.flowIdIgnoredHint(flowId, id, true)) return w;
      const still = this.doc.get(id) === flow && !this.doc.has(flowId);
      return { ...w, hint: StaleFlowReport.flowIdIgnoredHint(flowId, still ? id : undefined) };
    });
  }
}

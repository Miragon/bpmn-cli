import type { EditSession, FlowEnds, KeptFlow } from '../../document/EditSession.js';
import { ElementLabels } from '../../document/ids/ElementLabels.js';
import { isValidId } from '../../document/utils/slug.js';
import { type El, idOf } from '../../document/utils/moddle.js';
import type { ChangeSet } from '../../document/ChangeSet.js';
import type { Finding } from '../../document/Finding.js';
import { IdRegistry } from '../../document/ids/IdRegistry.js';
import { FlowIdFollower } from './FlowIdFollower.js';

/**
 * Warns W_FLOW_ID_STALE, once per batch and against its final state, for each kept flow
 * id that no longer names its ends.
 */
export class StaleFlowReport {
  constructor(private readonly edit: EditSession) {}

  /**
   * `deferred`: the flow kept its id, so its W_FLOW_ID_STALE names the rename command;
   * when no such warning comes, report puts the command back into this hint.
   */
  static flowIdIgnoredHint(flowId: string, entry: string | undefined, deferred = false): string {
    const rename = !entry ? '' : deferred ? `; W_FLOW_ID_STALE names the command that renames ${entry}` : `; rename the existing one with \`bpmn set <file> ${entry} id=${flowId}\``;
    return `--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node)${rename}.`;
  }

  /**
   * Each suggested id is reserved for the later hints, so following every hint never
   * collides. `before`: the flows' ends when the batch began.
   */
  report(changes: ChangeSet, before?: ReadonlyMap<El, FlowEnds>): void {
    const kept = this.edit.takeKeptFlows();
    if (!kept.size) return;
    const hinted = new IdRegistry(this.edit.doc.ids.values());
    for (const [flow, was] of kept) {
      const warning = this.warningFor(flow, was, hinted, before?.get(flow));
      if (warning) changes.warn(warning);
      else if (was.preferred) this.restoreFlowIdHints(changes, flow, was.id);
    }
  }

  /**
   * No warning when the flow is gone, renamed, names its ends again or was stale before
   * the batch. Renaming stays the human's call, together with the code that uses the id.
   */
  private warningFor(flow: El, { was, id: keptId, preferred }: KeptFlow, hinted: IdRegistry, began?: FlowEnds): Finding | undefined {
    const doc = this.edit.doc;
    const id = idOf(flow);
    const source = flow.get<El | undefined>('sourceRef');
    const target = flow.get<El | undefined>('targetRef');
    if (id !== keptId || doc.get(id) !== flow || !source || !target || new FlowIdFollower(this.edit).namesEnds(id, source, target)) return undefined;
    if (began?.[0] === source && began[1] === target) return undefined;
    const wanted = preferred?.target === target && isValidId(preferred.id) && !hinted.has(preferred.id) && !doc.has(preferred.id) ? preferred.id : undefined;
    const suggested = wanted ?? this.edit.idStyle.next(ElementLabels.flowRequest('bpmn:SequenceFlow', source, target), hinted).id;
    hinted.claim(suggested);
    return {
      code: 'W_FLOW_ID_STALE',
      message: `Flow ${id} kept its id, which names its old ends ${was}; it now runs ${idOf(source)} -> ${idOf(target)}`,
      element: id,
      related: [idOf(source), idOf(target)],
      hint: `Code and tests that use the id keep working; to rename it together with them: \`bpmn set <file> ${id} id=${suggested}\`.`,
    };
  }

  /** The W_OPTION_IGNORED hints that deferred to a W_FLOW_ID_STALE that never came. */
  private restoreFlowIdHints(changes: ChangeSet, flow: El, id: string): void {
    changes.warnings = changes.warnings.map((warning) => {
      const flowId = warning.code === 'W_OPTION_IGNORED' ? /^--flow-id (\S+) ignored/.exec(warning.message)?.[1] : undefined;
      if (!flowId || warning.hint !== StaleFlowReport.flowIdIgnoredHint(flowId, id, true)) return warning;
      const still = this.edit.doc.get(id) === flow && !this.edit.doc.has(flowId);
      return { ...warning, hint: StaleFlowReport.flowIdIgnoredHint(flowId, still ? id : undefined) };
    });
  }
}

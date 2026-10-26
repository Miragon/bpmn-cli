import type { Doc } from '../../document/Doc.js';
import type { Warning } from '../../document/CliError.js';
import { is, type El, idOf } from '../../document/utils/moddle.js';
import { laneOf } from '../../document/utils/lanes.js';
import { NodePlacementService } from '../NodePlacementService.js';
import type { Placement } from '../../commands/types.js';

/** `branching`: the source has several outgoing flows. */
interface CrossLane {
  source: El;
  target: El;
  from?: El;
  to?: El;
  branching: boolean;
}

/**
 * The lane a node placed without --lane inherits: the anchor's, or in a splice between two
 * lanes the lane of the row the layout draws it on. Decided before the node is placed,
 * since a splice may rename the flow it goes into.
 */
export class LaneInheritance {
  static readonly NONE = new LaneInheritance();

  private constructor(
    readonly lane?: El,
    private readonly cross?: CrossLane,
  ) {}

  /** The lane a placed node inherits; after a branching source it is the target's, as the layout puts the node on the target's row. */
  static of(doc: Doc, placement: Placement): LaneInheritance {
    const anchor = LaneInheritance.anchorOf(doc, placement);
    const lane = anchor ? laneOf(doc, anchor) : undefined;
    const flow = LaneInheritance.splicedFlow(doc, placement);
    if (!flow) return new LaneInheritance(lane);
    const source = flow.get<El>('sourceRef');
    const target = flow.get<El>('targetRef');
    const from = laneOf(doc, source);
    const to = laneOf(doc, target);
    if (from === to) return new LaneInheritance(lane);
    const branching = doc.outgoing(source).length > 1 && !!to;
    return new LaneInheritance(branching ? to : lane, { source, target, ...(from ? { from } : {}), ...(to ? { to } : {}), branching });
  }

  warning(id: string): Warning | undefined {
    const { lane, cross } = this;
    const other = cross && lane ? (lane === cross.from ? cross.to : cross.from) : undefined;
    if (!cross || !lane || !other) return undefined;
    const side = cross.branching
      ? `the lane of ${idOf(cross.target)}, on whose row the layout puts it after the branching ${idOf(cross.source)}`
      : `the lane of ${idOf(lane === cross.to ? cross.target : cross.source)}`;
    return {
      code: 'W_LANE_INHERITED',
      message: `${id} is in ${idOf(lane)} (${side}); the flow it went into runs from ${idOf(cross.source)} in ${cross.from ? idOf(cross.from) : 'no lane'} to ${idOf(cross.target)} in ${cross.to ? idOf(cross.to) : 'no lane'}`,
      element: id,
      related: [idOf(lane), idOf(other)],
      hint: `If ${idOf(other)} does it: \`bpmn move <file> ${id} --lane ${idOf(other)}\` (or --lane ${idOf(other)} when adding).`,
    };
  }

  /** For a moved node that keeps its own lane while the flow runs between two other lanes. */
  crossNote(id: string, own: El): string | undefined {
    const { cross } = this;
    if (!cross || own === cross.from || own === cross.to) return undefined;
    const there = this.lane;
    return `${id} stays in its lane ${idOf(own)}; the flow it went into runs from ${idOf(cross.source)} in ${cross.from ? idOf(cross.from) : 'no lane'} to ${idOf(cross.target)} in ${cross.to ? idOf(cross.to) : 'no lane'}${there ? ` (\`bpmn move <file> ${id} --lane ${idOf(there)}\` puts it on the row the layout gives a node there)` : ''}`;
  }

  private static anchorOf(doc: Doc, placement: Placement): El | undefined {
    if (placement.on) return doc.get(placement.on);
    if (placement.after) return doc.get(placement.after);
    if (placement.before) return doc.get(placement.before);
    if (placement.flow) return doc.get(placement.flow)?.get<El | undefined>('sourceRef');
    return undefined;
  }

  private static splicedFlow(doc: Doc, placement: Placement): El | undefined {
    const get = (id: string | undefined): El | undefined => (id ? doc.get(id) : undefined);
    switch (NodePlacementService.modeOf(placement)) {
      case 'flow':
        return get(placement.flow);
      case 'between': {
        const afterNode = get(placement.after);
        const beforeNode = get(placement.before);
        return afterNode && beforeNode ? doc.outgoing(afterNode).find((flow) => flow.get<El | undefined>('targetRef') === beforeNode) : undefined;
      }
      case 'after': {
        const afterNode = get(placement.after);
        const out = afterNode && !is(afterNode, 'bpmn:Gateway') ? doc.outgoing(afterNode) : [];
        return out.length === 1 ? out[0] : undefined;
      }
      case 'before': {
        const beforeNode = get(placement.before);
        const inc = beforeNode ? doc.incoming(beforeNode) : [];
        return inc.length === 1 ? inc[0] : undefined;
      }
      default:
        return undefined;
    }
  }
}

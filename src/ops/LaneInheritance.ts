import type { Doc } from '../model/Doc.js';
import type { Warning } from '../shared/CliError.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { laneOf } from './utils/lanes.js';
import { NodePlacement } from './NodePlacement.js';
import type { Placement } from './types.js';

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

  static of(doc: Doc, p: Placement): LaneInheritance {
    const anchor = LaneInheritance.anchorOf(doc, p);
    const lane = anchor ? laneOf(doc, anchor) : undefined;
    const flow = LaneInheritance.splicedFlow(doc, p);
    if (!flow) return new LaneInheritance(lane);
    const source = flow.get<El>('sourceRef');
    const target = flow.get<El>('targetRef');
    const from = laneOf(doc, source);
    const to = laneOf(doc, target);
    if (from === to) return new LaneInheritance(lane);
    // after a branching source the layout puts the node on the target's row
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

  private static anchorOf(doc: Doc, p: Placement): El | undefined {
    if (p.on) return doc.get(p.on);
    if (p.after) return doc.get(p.after);
    if (p.before) return doc.get(p.before);
    if (p.flow) return doc.get(p.flow)?.get<El | undefined>('sourceRef');
    return undefined;
  }

  private static splicedFlow(doc: Doc, p: Placement): El | undefined {
    const get = (id: string | undefined): El | undefined => (id ? doc.get(id) : undefined);
    switch (NodePlacement.modeOf(p)) {
      case 'flow':
        return get(p.flow);
      case 'between': {
        const a = get(p.after);
        const b = get(p.before);
        return a && b ? doc.outgoing(a).find((f) => f.get<El | undefined>('targetRef') === b) : undefined;
      }
      case 'after': {
        const a = get(p.after);
        const out = a && !is(a, 'bpmn:Gateway') ? doc.outgoing(a) : [];
        return out.length === 1 ? out[0] : undefined;
      }
      case 'before': {
        const b = get(p.before);
        const inc = b ? doc.incoming(b) : [];
        return inc.length === 1 ? inc[0] : undefined;
      }
      default:
        return undefined;
    }
  }
}

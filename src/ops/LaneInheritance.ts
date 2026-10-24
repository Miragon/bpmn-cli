/**
 * The lane a node gets when it is placed into a process without --lane
 * (`add`, and `move` of a node that has no lane at its new place).
 *
 * CONTRACT
 *  - LaneInheritance.of(doc, placement): decided before the node is placed (a
 *    splice may rename the flow it goes into). The lane of the anchor (the
 *    host for a boundary event, the after / before anchor, a flow's source);
 *    a splice into a flow whose ends are in different lanes takes the lane
 *    of the row the incremental layout draws the node on (diagram/place.ts:
 *    the target's row after a branching source, so then the target's lane;
 *    else the anchor's) and keeps both ends in `cross`.
 *  - warning(id): W_LANE_INHERITED for a cross-lane splice, naming the other
 *    lane and the command that moves the node there.
 *  - crossNote(id, lane): a `move` that keeps the node's own lane, neither
 *    of the two lanes the flow connects: says so and names the lane of the
 *    row the layout would draw a new node on.
 */
import type { Doc } from '../model/Doc.js';
import type { Warning } from '../shared/CliError.js';
import { is, type El, idOf } from '../model/utils/moddle.js';
import { laneOf } from './containers.js';
import { NodePlacement } from './NodePlacement.js';
import type { Placement } from './types.js';

/** A splice into a flow between two lanes: its ends and their lanes; `branching`: the source has several outgoing flows. */
interface CrossLane {
  source: El;
  target: El;
  from?: El;
  to?: El;
  branching: boolean;
}

export class LaneInheritance {
  /** No lane inherited (--lane given, or a place outside a process). */
  static readonly NONE = new LaneInheritance();

  private constructor(
    readonly lane?: El,
    private readonly cross?: CrossLane,
  ) {}

  /** The lane a node placed by `p` without --lane inherits (see the module contract). */
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
    // after a branching source the node goes on the target's row (diagram/place.ts splice rule): the target's lane
    const branching = doc.outgoing(source).length > 1 && !!to;
    return new LaneInheritance(branching ? to : lane, { source, target, ...(from ? { from } : {}), ...(to ? { to } : {}), branching });
  }

  /** W_LANE_INHERITED for a node `id` that got the lane in a cross-lane splice (undefined otherwise). */
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

  /**
   * A moved node `id` that keeps its own lane while the flow it went into runs
   * between two other lanes: a note naming them and the lane a new node would
   * get there (undefined when its lane is one of the two, or the flow stays in
   * one lane).
   */
  crossNote(id: string, own: El): string | undefined {
    const { cross } = this;
    if (!cross || own === cross.from || own === cross.to) return undefined;
    const there = this.lane;
    return `${id} stays in its lane ${idOf(own)}; the flow it went into runs from ${idOf(cross.source)} in ${cross.from ? idOf(cross.from) : 'no lane'} to ${idOf(cross.target)} in ${cross.to ? idOf(cross.to) : 'no lane'}${there ? ` (\`bpmn move <file> ${id} --lane ${idOf(there)}\` puts it on the row the layout gives a node there)` : ''}`;
  }

  /** The node whose lane a placed node inherits (host / anchor / flow source). */
  private static anchorOf(doc: Doc, p: Placement): El | undefined {
    if (p.on) return doc.get(p.on);
    if (p.after) return doc.get(p.after);
    if (p.before) return doc.get(p.before);
    if (p.flow) return doc.get(p.flow)?.get<El | undefined>('sourceRef');
    return undefined;
  }

  /** The flow a placement will splice the node into (looked up before it is placed), if any (NodePlacement.place). */
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

/**
 * Shared types of the "clean" layout engine.
 */
import type { El } from '../model/utils/moddle.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A flow node of one scope as the engine sees it. */
export interface GNode {
  el: El;
  id: string;
  width: number;
  height: number;
  kind: 'start' | 'end' | 'event' | 'gateway' | 'task' | 'subProcess' | 'eventSubProcess';
  /** boundary events attached to this node (in declaration order) */
  boundary: GNode[];
  /** host for boundary events */
  host?: GNode;
  /**
   * a boundary event on its host's top border instead of the bottom one (layout/clean/place.ts boundariesOnTop): its flows leave
   * it upwards over the top (layout/clean/route.ts), its label sits above the host (layout/clean/route.ts elementLabel)
   */
  onTop?: boolean;
  /** such an event's label goes to the upper left of it (layout/clean/place.ts boundariesOnTop: where the upper right is taken) */
  labelLeft?: boolean;
  /** expanded sub-process: its laid-out child scope */
  child?: ScopeLayout;
  /**
   * expanded sub-process: where its content sits (layout/clean/place.ts frameSubProcess): `left` and `top` from the
   * padding's left edge and the frame's top, `inner` the width of the content with its labels
   */
  childPad?: { left: number; top: number; inner: number };
  /** compensate boundary event: the handler it is associated with */
  compensationHandler?: GNode;
  /** compensation handler: the boundary event it hangs from */
  compensatedBy?: GNode;
  /** assigned by the placer */
  layer: number;
  row: number;
  /** band (branch) the node belongs to; nodes of one band share a row */
  band: number;
  /** set by the router: an edge leaves or enters through the top border (label goes aside) */
  topUsed?: boolean;
  /** final position (relative to the scope origin) */
  box: Box;
  /** outgoing / incoming sequence flows (declaration order) */
  out: GEdge[];
  in: GEdge[];
}

export interface GEdge {
  el: El;
  id: string;
  source: GNode;
  target: GNode;
  /** edge closes a cycle (drawn as a loop) */
  back: boolean;
  /**
   * empty band (gateway -> join without nodes): the reserved row and its y, set by the placer; the router
   * draws the flow straight instead when the row between the two is free (layout/clean/route.ts)
   */
  bandRow?: number;
  bandY?: number;
  /** waypoints, relative to the scope origin */
  points: Point[];
  label?: Box;
  /**
   * set by the router on a boundary event's flow that leaves the event downwards to a run below its host's row (at
   * its second waypoint's y; the host's lane holds it, layout/clean/engine.ts fitLaneLoops)
   */
  runsBelow?: boolean;
  /**
   * set by the router on such a flow that then goes over the top to its target, and on the flow of a boundary event
   * on its host's top border (GNode.onTop), which goes straight up over the top (its highest waypoints, its label
   * above them; the lane of both ends holds them, layout/clean/engine.ts fitLaneLoops)
   */
  runsAbove?: boolean;
}

/** One end of an association: a node/artifact box, or a point on a routed flow. */
export interface LinkEnd {
  box: Box;
  flow?: GEdge;
}

export interface GArtifact {
  el: El;
  id: string;
  kind: 'annotation' | 'dataObject' | 'dataStore';
  width: number;
  height: number;
  box: Box;
  /** what it belongs to: a flow node, or a point on a flow (zero-size box) */
  anchor?: LinkEnd;
  /** the flow node the artifact belongs to (undefined when anchored to a flow or unanchored) */
  anchorNode?: GNode;
  /** associations / data associations, with their waypoints */
  links: Array<{ el: El; id: string; from: LinkEnd; to: LinkEnd; points: Point[] }>;
}

/** A leaf lane as the router sees it: its nodes and its vertical extent. */
export interface LaneBandInfo {
  nodes: Set<GNode>;
  top: number;
  bottom: number;
}

export interface ScopeLayout {
  el: El;
  nodes: GNode[];
  edges: GEdge[];
  artifacts: GArtifact[];
  /** event sub-processes laid out below the main content */
  eventSubs: GNode[];
  /** compensation associations (compensate boundary event -> handler activity) */
  compensations: Array<{ el: El; id: string; event: GNode; handler: GNode; points: Point[] }>;
  /** content size (without padding) */
  width: number;
  height: number;
  /** lane bands (nested), relative to the scope origin */
  lanes: LaneBox[];
  /** leaf lanes while routing a laned scope (channels stay inside the lane) */
  laneBands?: LaneBandInfo[];
  /** data associations whose other end lives in another scope (drawn by the engine when both ends share a plane) */
  crossLinks: Array<{ el: El; id: string; sourceId: string; targetId: string }>;
}

export interface LaneBox {
  el: El;
  id: string;
  box: Box;
  children: LaneBox[];
}

/** Shared types of the "clean" layout engine. */
import type { El } from '../../document/utils/moddle.js';

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
  /** in declaration order */
  boundary: GNode[];
  host?: GNode;
  /** a boundary event on its host's top border: its flows leave upwards, its label sits above */
  onTop?: boolean;
  /** such an event's label goes to its upper left because the upper right is taken */
  labelLeft?: boolean;
  child?: ScopeLayout;
  /** `left` from the padding's left edge, `top` from the frame's top, `inner`: content width */
  childPad?: { left: number; top: number; inner: number };
  compensationHandler?: GNode;
  compensatedBy?: GNode;
  layer: number;
  row: number;
  /** the branch the node belongs to; nodes of one band share a row */
  band: number;
  /** an edge uses the top border, so the label goes aside */
  topUsed?: boolean;
  /** relative to the scope origin */
  box: Box;
  /** in declaration order */
  out: GEdge[];
  in: GEdge[];
}

export interface GEdge {
  el: El;
  id: string;
  source: GNode;
  target: GNode;
  /** closes a cycle, drawn as a loop */
  back: boolean;
  /** the reserved row of an empty branch (gateway -> join); unused when the flow can go straight */
  bandRow?: number;
  bandY?: number;
  /** relative to the scope origin */
  points: Point[];
  label?: Box;
  /** a boundary event's flow running below its host's row: the host's lane must hold it */
  runsBelow?: boolean;
  /** a flow going over the top to its target: the lane of both ends must hold it */
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
  /** a flow node, or a point on a flow as a zero-size box */
  anchor?: LinkEnd;
  /** undefined when anchored to a flow or unanchored */
  anchorNode?: GNode;
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
  eventSubs: GNode[];
  compensations: Array<{ el: El; id: string; event: GNode; handler: GNode; points: Point[] }>;
  /** without padding */
  width: number;
  height: number;
  /** relative to the scope origin */
  lanes: LaneBox[];
  /** while routing a laned scope, so channels stay inside the lane */
  laneBands?: LaneBandInfo[];
  /** data associations into another scope, drawn when both ends share a plane */
  crossLinks: Array<{ el: El; id: string; sourceId: string; targetId: string }>;
}

export interface LaneBox {
  el: El;
  id: string;
  box: Box;
  children: LaneBox[];
}

export type EdgeKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation' | 'other';

export interface DShape {
  id: string;
  el: El;
  /** undefined for an element the engine placed until PlaneWriter creates it */
  di?: El;
  bounds: Box;
  kind: ShapeKind;
  container: boolean;
  expanded?: boolean;
  label?: Box;
  hostId?: string;
  laneId?: string;
  poolId?: string;
  parentId?: string;
}

export interface DEdge {
  id: string;
  el: El;
  di?: El;
  kind: EdgeKind;
  sourceId?: string;
  targetId?: string;
  points: Point[];
  label?: Box;
}

export interface Plane {
  id: string;
  /** undefined for a plane the engine creates until PlaneWriter writes it */
  di?: El;
  /** collaboration, process or collapsed sub-process */
  rootId: string;
  root: El;
  shapes: Map<string, DShape>;
  edges: Map<string, DEdge>;
  dropped: El[];
  /** shapes without valid bounds count as undrawn and are placed reusing this DI and its colours */
  unbounded?: Map<string, El>;
  /** its content moved elsewhere, so PlaneWriter deletes the whole diagram */
  deleted?: boolean;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export type ShapeKind =
  | 'task'
  | 'subProcess'
  | 'event'
  | 'gateway'
  | 'boundary'
  | 'data'
  | 'annotation'
  | 'participant'
  | 'lane'
  | 'group'
  | 'other';

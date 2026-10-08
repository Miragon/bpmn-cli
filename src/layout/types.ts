/**
 * Shared types of the "clean" layout engine.
 */
import type { El } from '../model.js';

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
  /** expanded sub-process: its laid-out child scope */
  child?: ScopeLayout;
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
  /** empty band (gateway -> join without nodes): the reserved row and its y, set by the placer */
  bandRow?: number;
  bandY?: number;
  /** waypoints, relative to the scope origin */
  points: Point[];
  label?: Box;
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

export interface LayoutMetrics {
  hGap: number;
  vGap: number;
  loopGap: number;
  boundaryOffset: number;
}

export const METRICS: LayoutMetrics = {
  hGap: 60,
  vGap: 60,
  loopGap: 30,
  boundaryOffset: 25,
};

export const SIZES = {
  task: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  subProcessPadding: { top: 45, right: 30, bottom: 30, left: 30 },
  subProcessMin: { width: 200, height: 120 },
  participantHeader: 30,
  laneHeader: 30,
  lanePadding: 30,
  blackBoxHeight: 60,
  poolGap: 80,
  outerMargin: 80,
} as const;

export function center(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Estimated label box for a name rendered by bpmn-js (12px Arial, wrapped at `maxWidth`). */
export function labelSize(name: string, maxWidth = 90): { width: number; height: number; lines: number } {
  const words = name.split(/\s+/).filter(Boolean);
  const charW = 7;
  const pad = 12;
  const longest = Math.max(0, ...words.map((w) => w.length * charW + pad));
  const limit = Math.max(maxWidth, longest); // never break inside a word
  const lines: number[] = [];
  let cur = 0;
  for (const w of words) {
    const ww = w.length * charW;
    if (cur === 0) cur = ww;
    else if (cur + charW + ww + pad <= limit) cur += charW + ww;
    else {
      lines.push(cur);
      cur = ww;
    }
  }
  if (cur > 0 || !lines.length) lines.push(cur);
  const width = Math.max(20, Math.min(limit, Math.max(...lines) + pad));
  return { width, height: lines.length * LABEL_LINE, lines: lines.length };
}

export const LABEL_LINE = 14;

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

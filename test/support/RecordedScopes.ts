import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GNode, type GArtifact, type GArtifactKind, type GEdge, type GNodeKind, type ScopeLayout } from '../../src/drawing/full/scopes/GNode.js';
import { Box, Point } from '../../src/model/index.js';
import { ScopeSketch } from './ScopeSketch.js';

type BoxRow = [number, number, number, number];
type PointRow = [number, number];

interface NodeRow {
  id: string;
  kind: GNodeKind;
  w: number;
  h: number;
  host?: number | null;
  onTop?: boolean | null;
  labelLeft?: boolean | null;
  child: boolean;
  layer: number;
  row: number;
  band: number;
  topUsed?: boolean | null;
  box: BoxRow;
  name?: string | null;
  boundary: number[];
  out: number[];
  in: number[];
}

interface EdgeRow {
  id: string;
  s: number;
  t: number;
  back: boolean;
  bandRow?: number | null;
  bandY?: number | null;
  points: PointRow[];
  name?: string | null;
}

interface ScopeRow {
  width: number;
  height: number;
  top: number;
  nodes: NodeRow[];
  edges: EdgeRow[];
  artifacts: Array<{ kind: GArtifactKind; box: BoxRow; hostAnchor?: number | null; name?: string | null }>;
  compensations: PointRow[][];
  laneBands?: Array<{ nodes: number[]; top: number; bottom: number }> | null;
}

export interface RecordedScope {
  before: ScopeRow;
  after: { edges: Array<{ points: PointRow[] }> };
  faults?: { crossings: number; hits: number; labels: number };
}

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'drawing', 'channel-router-scopes.json');

export class RecordedScopes {
  static all(): RecordedScope[] {
    return JSON.parse(readFileSync(CORPUS, 'utf8'));
  }

  static layoutOf({ before }: RecordedScope): ScopeLayout {
    const nodes = before.nodes.map((row) => RecordedScopes.node(row));
    before.nodes.forEach((row, index) => {
      nodes[index]!.host = row.host === null || row.host === undefined ? undefined : nodes[row.host];
      nodes[index]!.boundary.push(...row.boundary.map((boundary) => nodes[boundary]!));
    });
    const edges = before.edges.map((row) => RecordedScopes.edge(row, nodes));
    before.nodes.forEach((row, index) => {
      nodes[index]!.out.push(...row.out.map((edge) => edges[edge]!));
      nodes[index]!.in.push(...row.in.map((edge) => edges[edge]!));
    });
    const layout = ScopeSketch.emptyLayout(ScopeSketch.element('bpmn:Process', 'recorded'), nodes.slice(0, before.top), edges, before.width, before.height);
    before.artifacts.forEach((row, index) => layout.artifacts.push(RecordedScopes.artifact(row, index, nodes)));
    layout.compensations.push(...before.compensations.map((points) => ({ el: layout.el, id: 'compensation', event: nodes[0]!, handler: nodes[0]!, points: points.map(([x, y]) => new Point(x, y)) })));
    layout.laneBands = before.laneBands?.map(({ nodes: members, top, bottom }) => ({ nodes: new Set(members.map((index) => nodes[index]!)), top, bottom }));
    return layout;
  }

  private static node(row: NodeRow): GNode {
    const node = new GNode(ScopeSketch.element('bpmn:Task', row.id, row.name ?? undefined), row.id, { width: row.w, height: row.h }, row.kind);
    node.box = new Box(...row.box);
    node.layer = row.layer;
    node.row = row.row;
    node.band = row.band;
    node.topUsed = row.topUsed ?? undefined;
    node.onTop = row.onTop ?? undefined;
    node.labelLeft = row.labelLeft ?? undefined;
    node.child = row.child ? ScopeSketch.emptyLayout(node.el, [], []) : undefined;
    return node;
  }

  private static edge(row: EdgeRow, nodes: readonly GNode[]): GEdge {
    const el = ScopeSketch.element('bpmn:SequenceFlow', row.id, row.name ?? undefined);
    return { el, id: row.id, source: nodes[row.s]!, target: nodes[row.t]!, back: row.back, bandRow: row.bandRow ?? undefined, bandY: row.bandY ?? undefined, points: row.points.map(([x, y]) => new Point(x, y)) };
  }

  private static artifact(row: ScopeRow['artifacts'][number], index: number, nodes: readonly GNode[]): GArtifact {
    const type = row.kind === 'annotation' ? 'bpmn:TextAnnotation' : 'bpmn:DataObjectReference';
    const artifact = ScopeSketch.artifact(type, `artifact_${index}`, row.kind, { width: row.box[2], height: row.box[3] }, row.name ?? undefined);
    artifact.box = new Box(...row.box);
    artifact.anchorNode = row.hostAnchor === null || row.hostAnchor === undefined ? undefined : nodes[row.hostAnchor];
    return artifact;
  }
}

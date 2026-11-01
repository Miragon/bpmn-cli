import { Point, Polyline, type Box, type Segment } from '../../../model/index.js';
import { Semantics } from '../../plane/Semantics.js';
import { RoutingArea } from '../routing/RoutingArea.js';
import type { GArtifact, GNode, LaneBandInfo, LinkEnd, ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { LinkPath } from './LinkPath.js';
import { LinkPaths } from './LinkPaths.js';
import type { LinkEnds } from './LinkRuns.js';

interface Lines {
  crossed: Segment[];
  kept: Segment[];
  spareKept: Segment[];
  joined: Segment[];
}

interface LinkJob {
  ends: LinkEnds;
  lines: Lines;
  borders: readonly number[];
  lane: LaneBandInfo | undefined;
  spare: number;
}

export class LinkRouter {
  private static readonly LENGTH = 0.002;
  private static readonly NOTE_CROSSING = 200 * LinkRouter.LENGTH;
  private static readonly LEAVE_LANE = 500 * LinkRouter.LENGTH;
  private static readonly SHAPE_CUT = 1000;
  private static readonly NOTE_CUT = 500;
  private static readonly LINE_CROSSING = 8;
  private static readonly HIDDEN = 300;
  private static readonly NOTE_ON_BORDER = 100;
  private static readonly DATA_ON_BORDER = 8;
  private static readonly SLANT = 0.1;

  private readonly noteBoxes: Box[];
  private readonly boxes: Box[];

  constructor(
    private readonly layout: ScopeLayout,
    notesPlaced = false,
  ) {
    const scope = new Scope(layout);
    const placed = notesPlaced ? layout.artifacts : scope.routedArtifacts();
    this.boxes = scope.obstacles(placed.filter((artifact) => artifact.kind !== 'annotation'));
    this.noteBoxes = placed.filter((artifact) => artifact.kind === 'annotation').map((artifact) => artifact.box);
  }

  static compensationPath(eventBox: Box, handlerBox: Box): Point[] {
    const eventX = eventBox.center.x;
    const top = eventBox.bottom;
    if (eventX >= handlerBox.x && eventX <= handlerBox.right) {
      return LinkRouter.rounded([new Point(eventX, top), new Point(eventX, handlerBox.y)]);
    }
    const middleY = (top + handlerBox.y) / 2;
    const handlerX = handlerBox.center.x;
    return LinkRouter.rounded([new Point(eventX, top), new Point(eventX, middleY), new Point(handlerX, middleY), new Point(handlerX, handlerBox.y)]);
  }

  private static rounded(points: readonly Point[]): Point[] {
    return points.map((point) => new Point(Math.round(point.x), Math.round(point.y)));
  }

  private static linesOf(note: boolean, toFlow: boolean, flows: Segment[], drawn: Segment[], notes: ReadonlyMap<Box, Segment[]>, target: Box): Lines {
    const others = [...flows, ...drawn];
    if (note) {
      const joined = notes.get(target) ?? [];
      const apart = [...notes].flatMap(([box, segments]) => (box === target ? [] : segments));
      return { crossed: [...others, ...apart, ...joined], kept: [...others, ...apart], spareKept: [], joined };
    }
    if (toFlow) {
      return { crossed: others, kept: others, spareKept: [], joined: [] };
    }
    return { crossed: others, kept: [], spareKept: flows, joined: [...others, ...[...notes.values()].flat()] };
  }

  route(): void {
    const { layout } = this;
    const flows = new Scope(layout).routedSegments();
    for (const compensation of layout.compensations) {
      compensation.points = LinkRouter.compensationPath(compensation.event.box, compensation.handler.box);
    }
    const drawn: Segment[] = [];
    const notes = new Map<Box, Segment[]>();
    for (const artifact of layout.artifacts) {
      for (const link of artifact.links) {
        const other = link.from === artifact ? link.to : link.from;
        const note = Semantics.isAnnotationLine(link.el);
        const path = this.pathOf(artifact, other, note, LinkRouter.linesOf(note, !!other.flow, flows, drawn, notes, other.box));
        link.points = LinkRouter.rounded(link.from === artifact ? path : [...path].reverse());
        const segments = new Polyline(link.points).segments();
        if (note) {
          notes.set(other.box, [...(notes.get(other.box) ?? []), ...segments]);
        } else {
          drawn.push(...segments);
        }
      }
    }
  }

  private nodeAt(other: LinkEnd): GNode | undefined {
    if (other.flow) {
      return undefined;
    }
    const { nodes } = this.layout;
    return nodes.find((candidate) => candidate.box === other.box) ?? nodes.flatMap((candidate) => candidate.boundary).find((candidate) => candidate.box === other.box);
  }

  private pathOf(artifact: GArtifact, other: LinkEnd, note: boolean, lines: Lines): Point[] {
    const { laneBands } = this.layout;
    const [artifactBox, targetBox] = [artifact.box, other.box];
    const ends: LinkEnds = { artifactBox, targetBox, end: other.flow ? 'flow' : 'shape', note, shapes: [...this.boxes, ...this.noteBoxes] };
    const joins = note ? lines.joined.filter(({ start, end }) => start.y === end.y).map(({ start }) => start.y) : [];
    const lane = note ? laneBands?.find((band) => [artifactBox, targetBox].every((box) => box.y >= band.top && box.bottom <= band.bottom)) : undefined;
    const borders = laneBands?.flatMap((band) => [band.top, band.bottom]) ?? [];
    const { paths: ways, spare } = new LinkPaths(ends, this.nodeAt(other), laneBands).candidates(joins);
    const paths = note ? ways.map((way) => new Polyline(way).simplified()) : ways;
    let best: Point[] = [];
    let bestScore = Number.POSITIVE_INFINITY;
    paths.forEach((points, index) => {
      const score = this.scoreOf(points, index, { ends, lines, borders, lane, spare });
      if (score < bestScore) {
        best = points;
        bestScore = score;
      }
    });
    return best;
  }

  private scoreOf(points: Point[], index: number, { ends, lines, borders, lane, spare }: LinkJob): number {
    const { artifactBox, targetBox, note, shapes } = ends;
    const path = new LinkPath(points);
    const line = new Polyline(points);
    const crossingCost = note ? LinkRouter.NOTE_CROSSING : LinkRouter.LINE_CROSSING;
    let score = line.hitCount(this.boxes, [targetBox]) * LinkRouter.SHAPE_CUT + line.hitCount(this.noteBoxes, [targetBox]) * LinkRouter.NOTE_CUT + RoutingArea.crossingsOf(points, lines.crossed) * crossingCost + path.length() * LinkRouter.LENGTH + index * (note ? 0.001 : 0.01);
    if (path.runsAlongLines(lines.kept) || (index >= spare && path.runsAlongLines(lines.spareKept)) || path.runsAlongLines(lines.joined, 1)) {
      score += LinkRouter.HIDDEN;
    }
    if ((note || index >= spare) && path.hugsBorders(shapes, artifactBox, targetBox, borders)) {
      score += note ? LinkRouter.NOTE_ON_BORDER : LinkRouter.DATA_ON_BORDER;
    }
    if (lane && points.some((point) => point.y < lane.top || point.y > lane.bottom)) {
      score += LinkRouter.LEAVE_LANE;
    }
    return note && path.isDiagonal() ? score + LinkRouter.SLANT : score;
  }
}

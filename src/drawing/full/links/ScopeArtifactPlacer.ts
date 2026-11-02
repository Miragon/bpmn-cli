import { Box, Polyline } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GArtifact, GEdge, GNode, ScopeLayout } from '../scopes/GNode.js';
import { Scope } from '../scopes/Scope.js';
import { AnnotationSpots } from './AnnotationSpots.js';
import { BoundaryNotes } from './BoundaryNotes.js';

export class ScopeArtifactPlacer {
  private static readonly DATA_APART = 10;
  private static readonly JOIN_RISE_ROOM = 6;
  private static readonly BELOW_NODE = 20;
  private static readonly BELOW_BOUNDARY_NODE = 24;
  private static readonly BELOW_OFFSET = 30;
  private static readonly SPARE_DATA_APART = 20;
  private static readonly BAND_APART = 20;

  constructor(private readonly layout: ScopeLayout) {}

  private static belowX(node: GNode): number {
    const centerX = node.box.center.x;
    if (!node.boundary.length) {
      return centerX + Math.min(ScopeArtifactPlacer.BELOW_OFFSET, node.box.width / 2 - 10);
    }
    return node.keepsBoundaryLeft ? centerX + ScopeArtifactPlacer.BELOW_OFFSET : centerX - ScopeArtifactPlacer.BELOW_OFFSET;
  }

  private static flowPoint({ points }: GEdge): Box {
    let longest = -1;
    let middle = new Box(0, 0, 0, 0);
    for (const { start, end } of new Polyline(points).segments()) {
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > longest) {
        longest = length;
        middle = new Box((start.x + end.x) / 2, (start.y + end.y) / 2, 0, 0);
      }
    }
    return middle;
  }

  private static isRouted(artifact: GArtifact): boolean {
    return artifact.kind !== 'annotation' || !!artifact.anchorNode?.host;
  }

  placeAttached(): void {
    const { layout } = this;
    const taken: Box[] = [];
    const free = (box: Box): boolean => !taken.some((other) => other.overlaps(box, ScopeArtifactPlacer.DATA_APART));
    const notes = new BoundaryNotes(free, layout.nodes.flatMap((other) => [other.box, ...other.boundary.map((event) => event.box)]));
    for (const artifact of layout.artifacts) {
      const node = artifact.anchorNode;
      if (node && (artifact.kind !== 'annotation' || node.host)) {
        artifact.box = artifact.kind === 'annotation' ? notes.boxOf(artifact, node, node.host!) : this.dataBox(artifact, node, free);
        taken.push(artifact.box);
      }
    }
    this.placeUnanchored();
    const routed = layout.artifacts.filter(ScopeArtifactPlacer.isRouted);
    layout.width = Math.max(layout.width, ...routed.map((artifact) => artifact.box.right));
    layout.height = Math.max(layout.height, ...routed.map((artifact) => artifact.box.bottom));
  }

  placeAnnotations(): void {
    const { layout } = this;
    const notes = layout.artifacts.filter((artifact) => artifact.kind === 'annotation' && !artifact.anchorNode?.host);
    if (!notes.length) {
      return;
    }
    const spots = new AnnotationSpots(layout);
    const band: GArtifact[] = [];
    for (const note of notes) {
      const box = note.anchor ? spots.spotOf(note, note.anchor.box) : undefined;
      if (box) {
        note.box = box;
        spots.take(box);
      } else {
        band.push(note);
      }
    }
    if (band.length) {
      this.placeBand(band, spots);
    }
    layout.width = Math.max(layout.width, ...layout.artifacts.map((artifact) => artifact.box.right));
    layout.height = Math.max(layout.height, ...layout.artifacts.map((artifact) => artifact.box.bottom));
  }

  refreshFlowAnchors(): void {
    for (const artifact of this.layout.artifacts) {
      for (const end of artifact.links.flatMap((link) => [link.from, link.to])) {
        if (end.flow) {
          end.box = ScopeArtifactPlacer.flowPoint(end.flow);
        }
      }
      if (artifact.anchor?.flow) {
        artifact.anchor.box = ScopeArtifactPlacer.flowPoint(artifact.anchor.flow);
      }
    }
  }

  private dataBox(artifact: GArtifact, node: GNode, free: (box: Box) => boolean): Box {
    const placer = ScopeArtifactPlacer;
    const centerX = node.entriesFromBelow().length ? node.box.center.x + placer.JOIN_RISE_ROOM + artifact.width / 2 : placer.belowX(node);
    const top = node.box.bottom + (node.boundary.length ? placer.BELOW_BOUNDARY_NODE : placer.BELOW_NODE);
    let box = new Box(Math.round(centerX - artifact.width / 2), top, artifact.width, artifact.height);
    for (let frame = this.frameOver(box); frame || !free(box); frame = this.frameOver(box)) {
      box = frame ? new Box(box.x, frame.box.bottom + placer.BELOW_NODE, artifact.width, artifact.height) : new Box(box.x + artifact.width + placer.DATA_APART, box.y, artifact.width, artifact.height);
    }
    return box;
  }

  private frameOver(box: Box): GNode | undefined {
    return this.layout.nodes.find((node) => node.child && node.box.overlaps(box));
  }

  private placeUnanchored(): void {
    const { layout } = this;
    let left = layout.width + ShapeSizes.GAPS.hGap;
    for (const artifact of layout.artifacts) {
      if (artifact.kind !== 'annotation' && !artifact.anchorNode) {
        artifact.box = new Box(left, 0, artifact.width, artifact.height);
        left += artifact.width + ScopeArtifactPlacer.SPARE_DATA_APART;
      }
    }
  }

  private placeBand(band: GArtifact[], spots: AnnotationSpots): void {
    new Scope(this.layout).shift(0, Math.max(...band.map((note) => note.height)) + ShapeSizes.GAPS.vGap);
    band.sort((first, second) => spots.anchorX(first) - spots.anchorX(second));
    let cursor = 0;
    for (const note of band) {
      const left = Math.max(cursor, Math.round(spots.anchorX(note) - note.width / 2));
      note.box = new Box(left, 0, note.width, note.height);
      cursor = left + note.width + ScopeArtifactPlacer.BAND_APART;
    }
  }
}

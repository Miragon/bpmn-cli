import { Box } from '../../../model/index.js';
import type { GArtifact, GNode } from '../scopes/GNode.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';

export class BoundaryNotes {
  private static readonly NOTE_GAP = 8;
  private static readonly LABEL_GAP = 6;
  private static readonly DROP_WIDTH = 4;
  private static readonly DROP_DEPTH = 100000;
  private static readonly BLOCKER_KEEP = 4;
  private static readonly ATTEMPTS = 6;
  private static readonly HOST_EXIT_LEFT = [8, 20];

  constructor(
    private readonly free: (box: Box) => boolean,
    private readonly nodes: readonly Box[],
  ) {}

  private static dropLine(left: number, top: number): Box {
    return new Box(left - BoundaryNotes.DROP_WIDTH / 2, top, BoundaryNotes.DROP_WIDTH, BoundaryNotes.DROP_DEPTH);
  }

  private static blockers(event: GNode, host: GNode): Box[] {
    const found: Box[] = [];
    for (const sibling of host.boundary.filter((other) => other !== event)) {
      found.push(sibling.box);
      const label = ScopeLabels.of(sibling, 'boundary');
      if (label) {
        found.push(label);
      }
      if (sibling.out.length && !sibling.onTop) {
        found.push(BoundaryNotes.dropLine(sibling.box.center.x, sibling.box.y));
      }
    }
    if (host.out.some((flow) => !flow.back && flow.target.box.center.y > host.box.center.y + 1)) {
      found.push(...BoundaryNotes.HOST_EXIT_LEFT.map((offset) => BoundaryNotes.dropLine(host.box.x + offset, host.box.bottom)));
    }
    return found;
  }

  boxOf(note: GArtifact, event: GNode, host: GNode): Box {
    const blockers = BoundaryNotes.blockers(event, host);
    const gap = BoundaryNotes.NOTE_GAP;
    const near = event.box.x - gap - note.width;
    const top = host.box.bottom + gap;
    return (blockers.length ? this.clearSpot(note, event, host, blockers, near, top) : undefined) ?? this.stacked(note, near, top);
  }

  private stacked(note: GArtifact, left: number, top: number): Box {
    let box = new Box(left, top, note.width, note.height);
    while (!this.free(box)) {
      box = new Box(left, box.y + note.height + BoundaryNotes.NOTE_GAP, note.width, note.height);
    }
    return box;
  }

  private clearSpot(note: GArtifact, event: GNode, host: GNode, blockers: readonly Box[], near: number, top: number): Box | undefined {
    const gap = BoundaryNotes.NOTE_GAP;
    const others = this.nodes.filter((box) => box !== host.box && box !== event.box);
    const isClear = (box: Box): boolean => this.free(box) && !blockers.some((blocker) => blocker.overlaps(box, BoundaryNotes.BLOCKER_KEEP)) && !others.some((other) => other.overlaps(box, gap));
    const label = ScopeLabels.of(event, 'boundary');
    const right = { left: event.box.right + gap, top: Math.max(top, label ? label.bottom + BoundaryNotes.LABEL_GAP : top) };
    const far = Math.min(near, Math.min(...blockers.map((blocker) => blocker.x)) - gap - note.width);
    const spots = [{ left: near, top }, right, ...(far >= 0 ? [{ left: far, top }] : [])];
    for (let attempt = 0; attempt < BoundaryNotes.ATTEMPTS; attempt++) {
      const dy = attempt * (note.height + gap);
      const box = spots.map((spot) => new Box(spot.left, spot.top + dy, note.width, note.height)).find(isClear);
      if (box) {
        return box;
      }
    }
    return undefined;
  }
}

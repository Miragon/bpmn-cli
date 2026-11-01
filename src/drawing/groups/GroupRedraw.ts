import { Box, DiagramIndex, type BpmnElement, type BpmnTree } from '../../model/index.js';
import { GroupFit } from './GroupFit.js';
import { GroupShapes, type GroupItem, type RememberedGroup } from './GroupShapes.js';

export interface RedrawnGroups {
  drawn: string[];
  kept: string[];
  moved: string[];
}

type Home = { plane: BpmnElement; root: string | undefined; shapes: Map<string, GroupItem> };

type Fitted = { group: RememberedGroup; el: BpmnElement; home: Home; ids: Set<string>; top: number; box: Box; label?: Box | undefined };

export class GroupRedraw {
  private static readonly PASSES = 8;

  private readonly homes: Home[];
  private readonly elements: Map<string, BpmnElement>;
  private readonly finished = new Map<RememberedGroup, { plane: BpmnElement; shape: BpmnElement }>();
  private readonly fitted: Fitted[] = [];
  private readonly empty: Array<{ group: RememberedGroup; el: BpmnElement }> = [];
  private readonly result: RedrawnGroups = { drawn: [], kept: [], moved: [] };

  constructor(
    private readonly tree: BpmnTree,
    shapes: GroupShapes,
    private readonly shapeId: (id: string) => string,
  ) {
    this.elements = shapes.groupElements();
    this.homes = shapes.planes().map((plane) => ({ plane, root: plane.peek<BpmnElement>('bpmnElement')?.peek<string>('id'), shapes: GroupShapes.items(plane) }));
  }

  static boundsDi(tree: BpmnTree, box: Box): BpmnElement {
    return tree.build('dc:Bounds', { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
  }

  private static rounded(box: Box): Box {
    return new Box(Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height));
  }

  private static homeOf(homes: readonly Home[], group: RememberedGroup): Home | undefined {
    let home: Home | undefined;
    let most = 0;
    for (const candidate of homes) {
      const members = group.members.filter((id) => candidate.shapes.has(id)).length;
      if (members > most || (members === most && members > 0 && candidate.root === group.root)) {
        home = candidate;
        most = members;
      }
    }
    return home;
  }

  run(groups: readonly RememberedGroup[]): RedrawnGroups {
    if (!groups.length || !this.homes.length) {
      return this.result;
    }
    const done = new Set<string>();
    for (const group of [...groups].sort((first, second) => GroupShapes.areaOf(first) - GroupShapes.areaOf(second))) {
      const el = this.elements.get(group.id);
      if (el && !done.has(group.id) && !this.homes.some((home) => home.shapes.has(group.id))) {
        done.add(group.id);
        this.place(group, el);
      }
    }
    this.fitAgain();
    for (const { group, el, home, box, label } of this.fitted) {
      this.finish(group, el, home.plane, box, label);
    }
    this.keepEmpty();
    for (const group of groups) {
      const drawn = this.finished.get(group);
      if (drawn) {
        drawn.plane.add('planeElement', drawn.shape);
      }
    }
    return this.result;
  }

  private place(group: RememberedGroup, el: BpmnElement): void {
    const home = GroupRedraw.homeOf(this.homes, group);
    if (!home) {
      if (group.bounds.width && group.bounds.height) {
        this.empty.push({ group, el });
      }
      return;
    }
    const named = !!el.name?.trim();
    const ids = new Set(group.members.filter((id) => home.shapes.has(id)));
    const top = GroupFit.PAD + (named ? GroupFit.NAME_ROOM : 0);
    const box = GroupRedraw.rounded(new GroupFit(home.shapes, group.id, top).fit(ids));
    const label = named && group.label ? GroupFit.labelOn(box, group.label) : undefined;
    home.shapes.set(group.id, { id: group.id, el, box, whole: true, label });
    this.fitted.push({ group, el, home, ids, top, box, label });
    this.result.drawn.push(group.id);
  }

  private fitAgain(): void {
    let changed = new Set<string>();
    for (let pass = 0; pass < GroupRedraw.PASSES; pass++) {
      const again = this.fitted.filter((fit) => this.needsRefit(fit, changed));
      if (!again.length) {
        return;
      }
      changed = new Set();
      for (const fit of again) {
        if (this.refit(fit)) {
          changed.add(fit.group.id);
        }
      }
    }
  }

  private needsRefit(fit: Fitted, changed: ReadonlySet<string>): boolean {
    return this.fitted.some((other) => other !== fit && other.home === fit.home && (fit.ids.has(other.group.id) ? changed.has(other.group.id) : other.box.isInside(fit.box)));
  }

  private refit(fit: Fitted): boolean {
    const box = GroupRedraw.rounded(new GroupFit(fit.home.shapes, fit.group.id, fit.top).fit(fit.ids));
    if (Box.same(box, fit.box, 0)) {
      return false;
    }
    fit.box = box;
    fit.label = fit.label && GroupFit.labelOn(box, fit.label);
    fit.home.shapes.set(fit.group.id, { id: fit.group.id, el: fit.el, box, whole: true, label: fit.label });
    return true;
  }

  private keepEmpty(): void {
    const placed = new Map<BpmnElement, Box[]>();
    for (const { group, el } of this.empty) {
      const home = this.homes.find((candidate) => candidate.root === group.root) ?? this.homes[0]!;
      const here = placed.get(home.plane) ?? [];
      const box = this.keptBounds(home, group.bounds, here);
      const [dx, dy] = [box.x - group.bounds.x, box.y - group.bounds.y];
      const label = group.label && new Box(group.label.x + dx, group.label.y + dy, group.label.width, group.label.height);
      this.finish(group, el, home.plane, box, label);
      placed.set(home.plane, [...here, box, ...(label ? [label] : [])]);
      this.result.kept.push(group.id);
      if (dx || dy) {
        this.result.moved.push(group.id);
      }
    }
  }

  private keptBounds(home: Home, old: Box, placed: readonly Box[]): Box {
    const shapes = [...home.shapes.values()];
    const isTaken = (box: Box): boolean => placed.some((other) => other.overlaps(box)) || shapes.some((shape) => (shape.box.overlaps(box) && !(shape.whole && box.isInside(shape.box))) || !!shape.label?.overlaps(box));
    const drawing = isTaken(old) ? this.extentOf(home) : undefined;
    if (!drawing) {
      return old;
    }
    const box = new Box(drawing.x, drawing.bottom + GroupFit.PAD, old.width, old.height);
    for (let hit = placed.find((other) => other.overlaps(box)); hit; hit = placed.find((other) => other.overlaps(box))) {
      box.y = hit.bottom + GroupFit.PAD;
    }
    return box;
  }

  private extentOf({ plane, shapes }: Home): Box | undefined {
    const boxes = [...shapes.values()].flatMap((shape) => [shape.box, ...(shape.label ? [shape.label] : [])]);
    for (const edge of plane.list('planeElement').filter((element) => element.is('bpmndi:BPMNEdge'))) {
      const points = edge.list('waypoint').map((waypoint) => [waypoint.peek<number>('x'), waypoint.peek<number>('y')] as const);
      boxes.push(...points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => new Box(x!, y!, 0, 0)));
      const label = DiagramIndex.boxOf(edge.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
      if (label) {
        boxes.push(label);
      }
    }
    return Box.unionAll(boxes);
  }

  private finish(group: RememberedGroup, el: BpmnElement, plane: BpmnElement, box: Box, label: Box | undefined): void {
    const { tree } = this;
    const shape = tree.build('bpmndi:BPMNShape', { id: this.shapeId(group.id), bpmnElement: el, bounds: GroupRedraw.boundsDi(tree, box) });
    if (label) {
      shape.set('label', tree.build('bpmndi:BPMNLabel', { bounds: GroupRedraw.boundsDi(tree, label) }));
    }
    this.finished.set(group, { plane, shape });
  }
}

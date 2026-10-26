import type { BpmnModdle } from 'bpmn-moddle';
import { addTo, groupName, is, type El } from '../../document/utils/moddle.js';
import { bottom, containsPoint, cx, cy, inside, overlaps, right, union, unionAll, type Box, type Point } from '../utils/geom.js';
import { boxOf, idOf, raw, rawList } from '../utils/raw.js';
import { labelSize } from '../utils/text.js';

export const GROUP_PAD = 20;
/** bpmn-js puts a group's 20 px label at the top of its box */
const NAME_ROOM = 20;
const ROUNDS = 8;

export interface RememberedGroup {
  id: string;
  /** id of the element the group's plane showed */
  root?: string;
  bounds: Box;
  label?: Box;
  /** elements referencing the group's category value, else the shapes inside its box */
  members: string[];
}

export interface RedrawnGroups {
  drawn: string[];
  /** groups without a drawn member: kept at their old size */
  kept: string[];
  /** those of `kept` moved below the drawing because shapes now lie on their old box */
  moved: string[];
}

interface Item {
  id: string;
  el: El;
  box: Box;
  label?: Box;
  /** pools, lanes, expanded sub-processes and groups: members only when inside whole */
  whole: boolean;
  host?: string;
}

/**
 * Draws groups again after a full redraw: no engine knows where a group box goes, so each group
 * is remembered with the elements its box held and drawn again around their new places.
 * Reads the model raw, since `get()` would materialise empty collections on semantic elements.
 */
export class Groups {
  constructor(private readonly defs: El) {}

  private isGroupShape(pe: El): boolean {
    return is(pe, 'bpmndi:BPMNShape') && is(raw(pe, 'bpmnElement'), 'bpmn:Group');
  }

  /** The first DI of an element wins. */
  private items(plane: unknown): Map<string, Item> {
    const out = new Map<string, Item>();
    for (const pe of rawList(plane, 'planeElement')) {
      if (!is(pe, 'bpmndi:BPMNShape')) continue;
      const el = raw<El>(pe, 'bpmnElement');
      const id = idOf(el);
      const box = boxOf(raw(pe, 'bounds'));
      if (!el || !id || !box || out.has(id)) continue;
      const label = boxOf(raw(raw(pe, 'label'), 'bounds'));
      const whole = is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || is(el, 'bpmn:Group') || raw<boolean>(pe, 'isExpanded') === true;
      const host = is(el, 'bpmn:BoundaryEvent') ? idOf(raw(el, 'attachedToRef')) : undefined;
      out.set(id, { id, el, box, whole, ...(label ? { label } : {}), ...(host ? { host } : {}) });
    }
    return out;
  }

  private holds(box: Box, item: Item): boolean {
    return item.whole ? inside(item.box, box) : containsPoint(box, { x: cx(item.box), y: cy(item.box) });
  }

  private categoryMembers(): Map<El, string[]> {
    const out = new Map<El, string[]>();
    const visit = (scope: unknown): void => {
      for (const fe of rawList(scope, 'flowElements')) {
        const id = idOf(fe);
        for (const value of rawList(fe, 'categoryValueRef')) if (id) out.set(value, [...(out.get(value) ?? []), id]);
        if (rawList(fe, 'flowElements').length) visit(fe);
      }
    };
    for (const root of rawList(this.defs, 'rootElements')) if (is(root, 'bpmn:Process')) visit(root);
    return out;
  }

  remembered(): RememberedGroup[] {
    const out: RememberedGroup[] = [];
    let byValue: Map<El, string[]> | undefined;
    for (const diagram of rawList(this.defs, 'diagrams')) {
      const plane = raw<El>(diagram, 'plane');
      if (!rawList(plane, 'planeElement').some(this.isGroupShape)) continue;
      const shapes = this.items(plane);
      for (const group of shapes.values()) {
        if (!is(group.el, 'bpmn:Group')) continue;
        byValue ??= this.categoryMembers();
        const value = raw<El>(group.el, 'categoryValueRef');
        const referenced = (value && byValue.get(value)) || [];
        const members = referenced.length ? referenced : [...shapes.values()].filter((shape) => shape !== group && this.holds(group.box, shape)).map((shape) => shape.id);
        out.push({ id: group.id, root: idOf(raw(plane, 'bpmnElement')), bounds: group.box, ...(group.label ? { label: group.label } : {}), members });
      }
    }
    return out;
  }

  /** Groups `add group` made: no shape yet, members by category value, a 0 x 0 box. */
  undrawn(): RememberedGroup[] {
    const drawn = new Set<string>();
    for (const diagram of rawList(this.defs, 'diagrams')) for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) if (is(pe, 'bpmndi:BPMNShape')) drawn.add(idOf(raw(pe, 'bpmnElement')) ?? '');
    const byValue = this.categoryMembers();
    const out: RememberedGroup[] = [];
    for (const [id, group] of this.groupElements()) {
      const value = raw<El>(group, 'categoryValueRef');
      const members = (value && byValue.get(value)) || [];
      if (drawn.has(id) || !members.length) continue;
      const name = groupName(group)?.trim();
      const size = name ? labelSize(name) : undefined;
      out.push({ id, bounds: { x: 0, y: 0, width: 0, height: 0 }, ...(size ? { label: { x: 0, y: 0, width: size.width, height: size.height } } : {}), members });
    }
    return out;
  }

  members(): Map<string, string[]> {
    const out = new Map([...this.groupElements().keys()].map((id): [string, string[]] => [id, []]));
    for (const group of [...this.remembered(), ...this.undrawn()]) if (!out.get(group.id)?.length) out.set(group.id, group.members);
    return out;
  }

  /** Element id -> the groups that held it, outermost (largest old box) first. */
  static membersOf(groups: readonly RememberedGroup[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const area = (group: RememberedGroup): number => group.bounds.width * group.bounds.height;
    for (const group of [...groups].sort((first, second) => area(second) - area(first))) for (const id of group.members) out.set(id, [...(out.get(id) ?? []), group.id]);
    return out;
  }

  private groupElements(): Map<string, El> {
    const out = new Map<string, El>();
    const visit = (scope: unknown): void => {
      for (const artifact of rawList(scope, 'artifacts')) if (is(artifact, 'bpmn:Group') && idOf(artifact)) out.set(idOf(artifact)!, artifact);
      for (const fe of rawList(scope, 'flowElements')) if (rawList(fe, 'flowElements').length || rawList(fe, 'artifacts').length) visit(fe);
    };
    for (const root of rawList(this.defs, 'rootElements')) visit(root);
    return out;
  }

  private named(group: El): boolean {
    return !!groupName(group)?.trim();
  }

  /**
   * Each side stops half-way to a non-member or to the border of a frame around `u`.
   * Other groups are ignored, so the order groups are drawn in never changes a box.
   */
  private padded(shapes: Map<string, Item>, self: string, ids: Set<string>, memberUnion: Box, top: number): Box {
    const half = (gap: number): number => Math.max(0, Math.floor(gap / 2));
    let [topPad, rightPad, bottomPad, leftPad] = [top, GROUP_PAD, GROUP_PAD, GROUP_PAD];
    for (const shape of shapes.values()) {
      if (shape.id === self || ids.has(shape.id) || is(shape.el, 'bpmn:Group')) continue;
      const shapeBox = shape.box;
      if (shape.whole && inside(memberUnion, shapeBox)) {
        [topPad, rightPad, bottomPad, leftPad] = [Math.min(topPad, half(memberUnion.y - shapeBox.y)), Math.min(rightPad, half(right(shapeBox) - right(memberUnion))), Math.min(bottomPad, half(bottom(shapeBox) - bottom(memberUnion))), Math.min(leftPad, half(memberUnion.x - shapeBox.x))];
        continue;
      }
      const across = shapeBox.x < right(memberUnion) + GROUP_PAD && right(shapeBox) > memberUnion.x - GROUP_PAD;
      const along = shapeBox.y < bottom(memberUnion) + GROUP_PAD && bottom(shapeBox) > memberUnion.y - top;
      if (across && shapeBox.y >= bottom(memberUnion)) bottomPad = Math.min(bottomPad, half(shapeBox.y - bottom(memberUnion)));
      if (across && bottom(shapeBox) <= memberUnion.y) topPad = Math.min(topPad, half(memberUnion.y - bottom(shapeBox)));
      if (along && shapeBox.x >= right(memberUnion)) rightPad = Math.min(rightPad, half(shapeBox.x - right(memberUnion)));
      if (along && right(shapeBox) <= memberUnion.x) leftPad = Math.min(leftPad, half(memberUnion.x - right(shapeBox)));
    }
    return { x: memberUnion.x - leftPad, y: memberUnion.y - topPad, width: memberUnion.width + leftPad + rightPad, height: memberUnion.height + topPad + bottomPad };
  }

  /** A member's label only grows the box when it pulls no other shape into it. */
  private withLabels(shapes: Map<string, Item>, self: string, ids: Set<string>): Box {
    let memberUnion = unionAll([...ids].map((id) => shapes.get(id)!.box))!;
    const others = [...shapes.values()].filter((shape) => shape.id !== self && !ids.has(shape.id) && !is(shape.el, 'bpmn:Group') && !(shape.whole && inside(memberUnion, shape.box)));
    for (const id of [...ids].sort()) {
      const label = shapes.get(id)!.label;
      if (!label) continue;
      const grown = union(memberUnion, label);
      if (others.every((other) => !overlaps(other.box, grown) || overlaps(other.box, memberUnion))) memberUnion = grown;
    }
    return memberUnion;
  }

  /**
   * Grows `ids` to everything the box holds; a boundary event joins together with its host, never
   * alone.
   */
  private fit(shapes: Map<string, Item>, self: string, ids: Set<string>, top: number): Box {
    const withEvents = (): void => {
      for (const shape of shapes.values()) if (shape.host && ids.has(shape.host)) ids.add(shape.id);
    };
    withEvents();
    let box: Box | undefined;
    for (let round = 0; round < ROUNDS; round++) {
      box = this.padded(shapes, self, ids, this.withLabels(shapes, self, ids), top);
      const size = ids.size;
      for (const shape of shapes.values()) {
        if (shape.id === self || ids.has(shape.id) || !this.holds(box, shape)) continue;
        ids.add(shape.id);
        if (shape.host && shapes.has(shape.host)) ids.add(shape.host);
      }
      withEvents();
      if (ids.size === size) break;
    }
    return box!;
  }

  private boundsEl(moddle: BpmnModdle, box: Box): El {
    return moddle.create('dc:Bounds', { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }) as El;
  }

  private extentOf(plane: El, shapes: Map<string, Item>): Box | undefined {
    const boxes: Box[] = [];
    for (const shape of shapes.values()) boxes.push(shape.box, ...(shape.label ? [shape.label] : []));
    for (const pe of rawList(plane, 'planeElement')) {
      if (!is(pe, 'bpmndi:BPMNEdge')) continue;
      const pts = rawList(pe, 'waypoint').map((waypoint) => ({ x: raw<number>(waypoint, 'x'), y: raw<number>(waypoint, 'y') })).filter((point): point is Point => Number.isFinite(point.x) && Number.isFinite(point.y));
      boxes.push(...pts.map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 })));
      const label = boxOf(raw(raw(pe, 'label'), 'bounds'));
      if (label) boxes.push(label);
    }
    return unionAll(boxes);
  }

  /** A group without drawn members keeps its old bounds while they are free, else goes below. */
  private keptBounds(plane: El, shapes: Map<string, Item>, old: Box, placed: readonly Box[]): Box {
    const taken = (box: Box): boolean =>
      placed.some((placedBox) => overlaps(placedBox, box)) ||
      [...shapes.values()].some((shape) => (overlaps(shape.box, box) && !(shape.whole && inside(box, shape.box))) || (!!shape.label && overlaps(shape.label, box)));
    if (!taken(old)) return old;
    const drawing = this.extentOf(plane, shapes);
    if (!drawing) return old;
    const box = { x: drawing.x, y: bottom(drawing) + GROUP_PAD, width: old.width, height: old.height };
    for (let hit = placed.find((placedBox) => overlaps(placedBox, box)); hit; hit = placed.find((placedBox) => overlaps(placedBox, box))) box.y = bottom(hit) + GROUP_PAD;
    return box;
  }

  /** Centred at the top of the box, where bpmn-js places a group's label. */
  private labelOn(box: Box, size: { width: number; height: number }): Box {
    return { x: Math.round(cx(box) - size.width / 2), y: Math.round(box.y + Math.max(0, NAME_ROOM / 2 - size.height / 2)), width: size.width, height: size.height };
  }

  relabel(moddle: BpmnModdle, group: El, name: string): void {
    for (const diagram of rawList(this.defs, 'diagrams')) {
      for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
        const box = is(pe, 'bpmndi:BPMNShape') && raw(pe, 'bpmnElement') === group ? boxOf(raw(pe, 'bounds')) : undefined;
        if (!box) continue;
        pe.set('label', name.trim() ? moddle.create('bpmndi:BPMNLabel', { bounds: this.boundsEl(moddle, this.labelOn(box, labelSize(name))) }) : undefined);
      }
    }
  }

  /**
   * Smallest old box first, so a group inside another one is drawn first and counts as its member.
   * Each group goes to the plane holding most of its members.
   * Boxes holding a later group or a changed member group are fitted again, so a second redraw is
   * stable. Groups around nothing come last and never become a member of another group.
   */
  redraw(moddle: BpmnModdle, groups: readonly RememberedGroup[], shapeId: (id: string) => string = (id) => `BPMNShape_${id}`): RedrawnGroups {
    const result: RedrawnGroups = { drawn: [], kept: [], moved: [] };
    if (!groups.length) return result;
    const elements = this.groupElements();
    const planes = rawList(this.defs, 'diagrams')
      .map((diagram) => raw<El>(diagram, 'plane'))
      .filter((plane): plane is El => !!plane)
      .map((plane) => ({ plane, root: idOf(raw(plane, 'bpmnElement')), shapes: this.items(plane) }));
    if (!planes.length) return result;
    const area = (group: RememberedGroup): number => group.bounds.width * group.bounds.height;
    const round = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    const shapes = new Map<RememberedGroup, { plane: El; shape: El }>();
    const done = new Set<string>();
    const empty: Array<{ group: RememberedGroup; el: El }> = [];
    const fitted: Array<{ group: RememberedGroup; el: El; home: (typeof planes)[number]; ids: Set<string>; top: number; box: Box; label?: Box }> = [];
    const add = (group: RememberedGroup, el: El, plane: El, box: Box, label: Box | undefined): void => {
      const shape = moddle.create('bpmndi:BPMNShape', { id: shapeId(group.id), bpmnElement: el, bounds: this.boundsEl(moddle, box) }) as El;
      if (label) shape.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.boundsEl(moddle, label) }));
      shapes.set(group, { plane, shape });
    };
    for (const group of [...groups].sort((first, second) => area(first) - area(second))) {
      const el = elements.get(group.id);
      if (!el || done.has(group.id) || planes.some((plane) => plane.shapes.has(group.id))) continue;
      done.add(group.id);
      let home: (typeof planes)[number] | undefined;
      let most = 0;
      for (const plane of planes) {
        const memberCount = group.members.filter((id) => plane.shapes.has(id)).length;
        if (memberCount > most || (memberCount === most && memberCount > 0 && plane.root === group.root)) {
          home = plane;
          most = memberCount;
        }
      }
      if (!home) {
        if (group.bounds.width && group.bounds.height) empty.push({ group, el });
        continue;
      }
      const hasName = this.named(el);
      const ids = new Set(group.members.filter((id) => home!.shapes.has(id)));
      const top = GROUP_PAD + (hasName ? NAME_ROOM : 0);
      const box = round(this.fit(home.shapes, group.id, ids, top));
      const label = hasName && group.label ? this.labelOn(box, group.label) : undefined;
      home.shapes.set(group.id, { id: group.id, el, box, whole: true, ...(label ? { label } : {}) });
      fitted.push({ group, el, home, ids, top, box, label });
      result.drawn.push(group.id);
    }
    let changed = new Set<string>();
    for (let pass = 0; pass < ROUNDS; pass++) {
      const again = fitted.filter((fit) => fitted.some((other) => other !== fit && other.home === fit.home && (fit.ids.has(other.group.id) ? changed.has(other.group.id) : inside(other.box, fit.box))));
      if (!again.length) break;
      changed = new Set();
      for (const fit of again) {
        const box = round(this.fit(fit.home.shapes, fit.group.id, fit.ids, fit.top));
        if (box.x === fit.box.x && box.y === fit.box.y && box.width === fit.box.width && box.height === fit.box.height) continue;
        changed.add(fit.group.id);
        fit.box = box;
        if (fit.label) fit.label = this.labelOn(box, fit.label);
        fit.home.shapes.set(fit.group.id, { id: fit.group.id, el: fit.el, box, whole: true, ...(fit.label ? { label: fit.label } : {}) });
      }
    }
    for (const fit of fitted) add(fit.group, fit.el, fit.home.plane, fit.box, fit.label);
    const placed = new Map<El, Box[]>();
    for (const { group, el } of empty) {
      const home = planes.find((plane) => plane.root === group.root) ?? planes[0]!;
      const here = placed.get(home.plane) ?? [];
      const box = this.keptBounds(home.plane, home.shapes, group.bounds, here);
      const [dx, dy] = [box.x - group.bounds.x, box.y - group.bounds.y];
      add(group, el, home.plane, box, group.label && { ...group.label, x: group.label.x + dx, y: group.label.y + dy });
      placed.set(home.plane, [...here, box, ...(group.label ? [{ ...group.label, x: group.label.x + dx, y: group.label.y + dy }] : [])]);
      result.kept.push(group.id);
      if (dx || dy) result.moved.push(group.id);
    }
    for (const group of groups) {
      const drawn = shapes.get(group);
      if (drawn) addTo(drawn.plane, 'planeElement', drawn.shape);
    }
    return result;
  }
}

import type { BpmnModdle } from 'bpmn-moddle';
import { addTo, groupName, is, type El } from '../model/utils/moddle.js';
import { bottom, containsPoint, cx, cy, inside, overlaps, right, union, unionAll, type Box, type Point } from './utils/geom.js';
import { boxOf, idOf, raw, rawList } from './utils/raw.js';
import { labelSize } from './utils/text.js';

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
      for (const g of shapes.values()) {
        if (!is(g.el, 'bpmn:Group')) continue;
        byValue ??= this.categoryMembers();
        const value = raw<El>(g.el, 'categoryValueRef');
        const referenced = (value && byValue.get(value)) || [];
        const members = referenced.length ? referenced : [...shapes.values()].filter((s) => s !== g && this.holds(g.box, s)).map((s) => s.id);
        out.push({ id: g.id, root: idOf(raw(plane, 'bpmnElement')), bounds: g.box, ...(g.label ? { label: g.label } : {}), members });
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
    for (const g of [...this.remembered(), ...this.undrawn()]) if (!out.get(g.id)?.length) out.set(g.id, g.members);
    return out;
  }

  /** Element id -> the groups that held it, outermost (largest old box) first. */
  static membersOf(groups: readonly RememberedGroup[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const area = (g: RememberedGroup): number => g.bounds.width * g.bounds.height;
    for (const g of [...groups].sort((a, b) => area(b) - area(a))) for (const id of g.members) out.set(id, [...(out.get(id) ?? []), g.id]);
    return out;
  }

  private groupElements(): Map<string, El> {
    const out = new Map<string, El>();
    const visit = (scope: unknown): void => {
      for (const a of rawList(scope, 'artifacts')) if (is(a, 'bpmn:Group') && idOf(a)) out.set(idOf(a)!, a);
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
  private padded(shapes: Map<string, Item>, self: string, ids: Set<string>, u: Box, top: number): Box {
    const half = (gap: number): number => Math.max(0, Math.floor(gap / 2));
    let [t, r, b, l] = [top, GROUP_PAD, GROUP_PAD, GROUP_PAD];
    for (const s of shapes.values()) {
      if (s.id === self || ids.has(s.id) || is(s.el, 'bpmn:Group')) continue;
      const o = s.box;
      if (s.whole && inside(u, o)) {
        [t, r, b, l] = [Math.min(t, half(u.y - o.y)), Math.min(r, half(right(o) - right(u))), Math.min(b, half(bottom(o) - bottom(u))), Math.min(l, half(u.x - o.x))];
        continue;
      }
      const across = o.x < right(u) + GROUP_PAD && right(o) > u.x - GROUP_PAD;
      const along = o.y < bottom(u) + GROUP_PAD && bottom(o) > u.y - top;
      if (across && o.y >= bottom(u)) b = Math.min(b, half(o.y - bottom(u)));
      if (across && bottom(o) <= u.y) t = Math.min(t, half(u.y - bottom(o)));
      if (along && o.x >= right(u)) r = Math.min(r, half(o.x - right(u)));
      if (along && right(o) <= u.x) l = Math.min(l, half(u.x - right(o)));
    }
    return { x: u.x - l, y: u.y - t, width: u.width + l + r, height: u.height + t + b };
  }

  /** A member's label only grows the box when it pulls no other shape into it. */
  private withLabels(shapes: Map<string, Item>, self: string, ids: Set<string>): Box {
    let u = unionAll([...ids].map((id) => shapes.get(id)!.box))!;
    const others = [...shapes.values()].filter((s) => s.id !== self && !ids.has(s.id) && !is(s.el, 'bpmn:Group') && !(s.whole && inside(u, s.box)));
    for (const id of [...ids].sort()) {
      const label = shapes.get(id)!.label;
      if (!label) continue;
      const grown = union(u, label);
      if (others.every((o) => !overlaps(o.box, grown) || overlaps(o.box, u))) u = grown;
    }
    return u;
  }

  private fit(shapes: Map<string, Item>, self: string, ids: Set<string>, top: number): Box {
    const withEvents = (): void => {
      for (const s of shapes.values()) if (s.host && ids.has(s.host)) ids.add(s.id);
    };
    withEvents();
    let box: Box | undefined;
    for (let round = 0; round < ROUNDS; round++) {
      box = this.padded(shapes, self, ids, this.withLabels(shapes, self, ids), top);
      const size = ids.size;
      for (const s of shapes.values()) {
        if (s.id === self || ids.has(s.id) || !this.holds(box, s)) continue;
        ids.add(s.id);
        // a boundary event joins together with its host, never alone
        if (s.host && shapes.has(s.host)) ids.add(s.host);
      }
      withEvents();
      if (ids.size === size) break;
    }
    return box!;
  }

  private boundsEl(moddle: BpmnModdle, b: Box): El {
    return moddle.create('dc:Bounds', { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }) as El;
  }

  private extentOf(plane: El, shapes: Map<string, Item>): Box | undefined {
    const boxes: Box[] = [];
    for (const s of shapes.values()) boxes.push(s.box, ...(s.label ? [s.label] : []));
    for (const pe of rawList(plane, 'planeElement')) {
      if (!is(pe, 'bpmndi:BPMNEdge')) continue;
      const pts = rawList(pe, 'waypoint').map((w) => ({ x: raw<number>(w, 'x'), y: raw<number>(w, 'y') })).filter((p): p is Point => Number.isFinite(p.x) && Number.isFinite(p.y));
      boxes.push(...pts.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
      const label = boxOf(raw(raw(pe, 'label'), 'bounds'));
      if (label) boxes.push(label);
    }
    return unionAll(boxes);
  }

  /** A group without drawn members keeps its old bounds while they are free, else goes below. */
  private keptBounds(plane: El, shapes: Map<string, Item>, old: Box, placed: readonly Box[]): Box {
    const taken = (b: Box): boolean =>
      placed.some((p) => overlaps(p, b)) ||
      [...shapes.values()].some((s) => (overlaps(s.box, b) && !(s.whole && inside(b, s.box))) || (!!s.label && overlaps(s.label, b)));
    if (!taken(old)) return old;
    const drawing = this.extentOf(plane, shapes);
    if (!drawing) return old;
    const box = { x: drawing.x, y: bottom(drawing) + GROUP_PAD, width: old.width, height: old.height };
    for (let hit = placed.find((p) => overlaps(p, box)); hit; hit = placed.find((p) => overlaps(p, box))) box.y = bottom(hit) + GROUP_PAD;
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
   */
  redraw(moddle: BpmnModdle, groups: readonly RememberedGroup[], shapeId: (id: string) => string = (id) => `BPMNShape_${id}`): RedrawnGroups {
    const result: RedrawnGroups = { drawn: [], kept: [], moved: [] };
    if (!groups.length) return result;
    const elements = this.groupElements();
    const planes = rawList(this.defs, 'diagrams')
      .map((d) => raw<El>(d, 'plane'))
      .filter((p): p is El => !!p)
      .map((plane) => ({ plane, root: idOf(raw(plane, 'bpmnElement')), shapes: this.items(plane) }));
    if (!planes.length) return result;
    const area = (g: RememberedGroup): number => g.bounds.width * g.bounds.height;
    const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
    const shapes = new Map<RememberedGroup, { plane: El; shape: El }>();
    const done = new Set<string>();
    const empty: Array<{ g: RememberedGroup; el: El }> = [];
    const fitted: Array<{ g: RememberedGroup; el: El; home: (typeof planes)[number]; ids: Set<string>; top: number; box: Box; label?: Box }> = [];
    const add = (g: RememberedGroup, el: El, plane: El, box: Box, label: Box | undefined): void => {
      const shape = moddle.create('bpmndi:BPMNShape', { id: shapeId(g.id), bpmnElement: el, bounds: this.boundsEl(moddle, box) }) as El;
      if (label) shape.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.boundsEl(moddle, label) }));
      shapes.set(g, { plane, shape });
    };
    for (const g of [...groups].sort((a, b) => area(a) - area(b))) {
      const el = elements.get(g.id);
      if (!el || done.has(g.id) || planes.some((p) => p.shapes.has(g.id))) continue;
      done.add(g.id);
      let home: (typeof planes)[number] | undefined;
      let most = 0;
      for (const p of planes) {
        const n = g.members.filter((id) => p.shapes.has(id)).length;
        if (n > most || (n === most && n > 0 && p.root === g.root)) {
          home = p;
          most = n;
        }
      }
      if (!home) {
        if (g.bounds.width && g.bounds.height) empty.push({ g, el });
        continue;
      }
      const hasName = this.named(el);
      const ids = new Set(g.members.filter((id) => home!.shapes.has(id)));
      const top = GROUP_PAD + (hasName ? NAME_ROOM : 0);
      const box = round(this.fit(home.shapes, g.id, ids, top));
      const label = hasName && g.label ? this.labelOn(box, g.label) : undefined;
      home.shapes.set(g.id, { id: g.id, el, box, whole: true, ...(label ? { label } : {}) });
      fitted.push({ g, el, home, ids, top, box, label });
      result.drawn.push(g.id);
    }
    // refit boxes holding a later group or a changed member group, so a second redraw is stable
    let changed = new Set<string>();
    for (let pass = 0; pass < ROUNDS; pass++) {
      const again = fitted.filter((f) => fitted.some((o) => o !== f && o.home === f.home && (f.ids.has(o.g.id) ? changed.has(o.g.id) : inside(o.box, f.box))));
      if (!again.length) break;
      changed = new Set();
      for (const f of again) {
        const box = round(this.fit(f.home.shapes, f.g.id, f.ids, f.top));
        if (box.x === f.box.x && box.y === f.box.y && box.width === f.box.width && box.height === f.box.height) continue;
        changed.add(f.g.id);
        f.box = box;
        if (f.label) f.label = this.labelOn(box, f.label);
        f.home.shapes.set(f.g.id, { id: f.g.id, el: f.el, box, whole: true, ...(f.label ? { label: f.label } : {}) });
      }
    }
    for (const f of fitted) add(f.g, f.el, f.home.plane, f.box, f.label);
    // groups around nothing come last and never become a member of another group
    const placed = new Map<El, Box[]>();
    for (const { g, el } of empty) {
      const home = planes.find((p) => p.root === g.root) ?? planes[0]!;
      const here = placed.get(home.plane) ?? [];
      const box = this.keptBounds(home.plane, home.shapes, g.bounds, here);
      const [dx, dy] = [box.x - g.bounds.x, box.y - g.bounds.y];
      add(g, el, home.plane, box, g.label && { ...g.label, x: g.label.x + dx, y: g.label.y + dy });
      placed.set(home.plane, [...here, box, ...(g.label ? [{ ...g.label, x: g.label.x + dx, y: g.label.y + dy }] : [])]);
      result.kept.push(g.id);
      if (dx || dy) result.moved.push(g.id);
    }
    for (const g of groups) {
      const drawn = shapes.get(g);
      if (drawn) addTo(drawn.plane, 'planeElement', drawn.shape);
    }
    return result;
  }
}

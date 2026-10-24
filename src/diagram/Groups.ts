/**
 * Groups over a full redraw. Neither engine knows where a `bpmn:Group` box
 * goes: the semantics only say that the group exists (bpmn-auto-layout
 * draws the rare group whose members reference its category value). A
 * redraw therefore remembers each drawn group with the elements inside its
 * box and draws it again around their new places.
 *
 * CONTRACT
 *  - remembered(), before an engine replaces the DI: one entry per
 *    group BPMNShape with valid bounds, with the id of the element its plane
 *    shows (`root`), its bounds, label bounds and members: the flow
 *    elements that reference the group's category value (a group `add
 *    group` made), else (a group drawn in a modeler) the elements of the
 *    other shapes of that plane whose centre lies inside the box (a pool,
 *    lane, expanded sub-process or group only when it lies inside whole).
 *    A drawing without a group shape gives [] after one pass over the
 *    plane elements; nothing else runs then.
 *  - undrawn(): one entry per group without a shape whose
 *    category value flow elements reference (a group `add group` made),
 *    with those elements as members, no box (0 x 0) and, when the group
 *    has a name, a label of the name's size; redraw draws it around
 *    its members (after a full redraw and after an incremental layout).
 *  - members(): every group by id with its members (`show`):
 *    those of remembered for a drawn group, else of undrawn,
 *    else none.
 *  - relabel(moddle, group, name), after a rename: each shape of
 *    the group gets a label of the new name's size, centred at the top of
 *    its box (an empty name: no label).
 *  - Groups.membersOf(groups): element id -> the ids of the groups that held it,
 *    outermost (largest old box) first; the clean engine keeps the parts of
 *    a scope no flow connects together by it (layout/clean/place.ts).
 *  - redraw(moddle, groups), after the redraw, in the order of
 *    the old boxes' areas (smallest first, so a group inside another one is
 *    drawn first and counts as its member): a group whose element is gone,
 *    or that the engine drew itself, is left alone. The others get one
 *    BPMNShape (id `BPMNShape_<id>`; restoreDiIds gives the old id back),
 *    appended in the order of the old DI to the plane that holds most of
 *    their members (ties: the plane of the old root). Its box is the union
 *    of those members' new bounds (with the boundary events of member
 *    activities) and of their labels, each label (in id order) only when
 *    it brings no other shape into the box; padded by GROUP_PAD on every
 *    side, at the top by GROUP_PAD plus NAME_ROOM when the group has a
 *    name. The shape id comes from `shapeId` (default `BPMNShape_<id>`). A side's padding stops half-way to a shape that is no member
 *    and half-way to the border of a pool, lane or expanded sub-process
 *    around the members. Other groups' boxes play no part in the padding
 *    or the labels (the members of a neighbour group already stop a side
 *    half-way), so the order groups are drawn in never changes a box.
 *    Then every shape whose centre lies in the box (frames and groups:
 *    inside whole; a boundary event together with its host) joins and the
 *    box is measured again, until none joins (at most 8 rounds). Then a box
 *    that holds a group drawn after it whole is measured again with it,
 *    and one whose member group changed after it, until no box changes (at
 *    most 8 passes), so a redraw of the redrawn file gives the same boxes.
 *    The padding never crosses a neighbour, but members the redraw spread
 *    apart can still overlap one that lies between them. The label (only when the group
 *    had label bounds and has a name) keeps its size, centred at the top
 *    of the box as bpmn-js places a group's label.
 *  - A group none of whose members is drawn and that had no box
 *    (undrawn) is left alone. Any other group none of whose members is drawn goes, after all the others, to
 *    the plane of its old root (else the first plane) and keeps its old
 *    bounds and label (named in `kept`), unless a shape or shape label of
 *    that plane (a frame that holds it whole aside) or another such group
 *    overlaps them: then it keeps its size and moves GROUP_PAD below the
 *    plane's drawing (shapes, labels, edges), left-aligned, below any
 *    group moved there before (named in `kept` and `moved`). Either way it
 *    is no member of another group, and a redraw of the result keeps it
 *    where it is.
 *  - Reads the model directly (never through `get()`, which would
 *    materialise empty collections on the semantic elements).
 */
import type { BpmnModdle } from 'bpmn-moddle';
import { addTo, groupName, is, type El } from '../model/utils/moddle.js';
import { bottom, containsPoint, cx, cy, inside, overlaps, right, union, unionAll, type Box, type Point } from './utils/geom.js';
import { boxOf, idOf, raw, rawList } from './utils/plane.js';
import { labelSize } from './utils/text.js';

/** padding of a redrawn group around its members */
export const GROUP_PAD = 20;
/** extra room above the members for a group's name (bpmn-js puts a 20 px label at the top) */
const NAME_ROOM = 20;
const ROUNDS = 8;

export interface RememberedGroup {
  id: string;
  /** id of the element the group's plane showed */
  root?: string;
  bounds: Box;
  label?: Box;
  /** element ids of what the box held (see the contract) */
  members: string[];
}

export interface RedrawnGroups {
  /** groups drawn around their members */
  drawn: string[];
  /** groups without a drawn member: kept at their old size (see the contract) */
  kept: string[];
  /** those of `kept` that moved below the drawing, since the redraw put shapes where their box was */
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

export class Groups {
  constructor(private readonly defs: El) {}

  private isGroupShape(pe: El): boolean {
    return is(pe, 'bpmndi:BPMNShape') && is(raw(pe, 'bpmnElement'), 'bpmn:Group');
  }

  /** The shapes of a plane with valid bounds, by element id (the first DI of an element wins). */
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

  /** `item` lies in `box`: its centre, or all of it for a frame or a group. */
  private holds(box: Box, item: Item): boolean {
    return item.whole ? inside(item.box, box) : containsPoint(box, { x: cx(item.box), y: cy(item.box) });
  }

  /** Flow element ids by the category values they reference (`categoryValueRef`), over every process and sub-process. */
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

  /** Records every drawn group with what its box holds (see the module contract). */
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

  /** The groups without a shape that flow elements reference by category value (see the module contract). */
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

  /** Every group by id with its members (see the module contract). */
  members(): Map<string, string[]> {
    const out = new Map([...this.groupElements().keys()].map((id): [string, string[]] => [id, []]));
    for (const g of [...this.remembered(), ...this.undrawn()]) if (!out.get(g.id)?.length) out.set(g.id, g.members);
    return out;
  }

  /** Element id -> the groups that held it, outermost first (see the module contract). */
  static membersOf(groups: readonly RememberedGroup[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const area = (g: RememberedGroup): number => g.bounds.width * g.bounds.height;
    for (const g of [...groups].sort((a, b) => area(b) - area(a))) for (const id of g.members) out.set(id, [...(out.get(id) ?? []), g.id]);
    return out;
  }

  /** Group elements by id, over the artifacts of every process, sub-process and collaboration. */
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
   * `u` padded by up to `pad` (`top` above), each side at most half-way to a
   * shape that is no member or to the border of a frame around it. Another
   * group's box is no neighbour: its members already stop the side half-way,
   * and the order the groups are drawn in must not change a box.
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

  /**
   * The union of the members' bounds, grown by each member's label (in id
   * order) that brings no other shape into it: a label never pulls the box
   * over a neighbour (another group's box aside, see padded).
   */
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

  /** The box around `ids` and what joins it (see the module contract); `top`: the padding wanted above. */
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

  /** The drawing of a plane: its shapes and their labels, and its edges' waypoints and labels. */
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

  /**
   * Where a group without a drawn member goes (see the contract): its old
   * bounds while nothing of the plane lies on them, else below the drawing.
   */
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

  /** A label of `size` centred at the top of `box`, where bpmn-js places a group's label. */
  private labelOn(box: Box, size: { width: number; height: number }): Box {
    return { x: Math.round(cx(box) - size.width / 2), y: Math.round(box.y + Math.max(0, NAME_ROOM / 2 - size.height / 2)), width: size.width, height: size.height };
  }

  /** `set <group> name=`: every shape of the group gets a label of the new name's size at the top of its box (an empty name: none). */
  relabel(moddle: BpmnModdle, group: El, name: string): void {
    for (const diagram of rawList(this.defs, 'diagrams')) {
      for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
        const box = is(pe, 'bpmndi:BPMNShape') && raw(pe, 'bpmnElement') === group ? boxOf(raw(pe, 'bounds')) : undefined;
        if (!box) continue;
        pe.set('label', name.trim() ? moddle.create('bpmndi:BPMNLabel', { bounds: this.boundsEl(moddle, this.labelOn(box, labelSize(name))) }) : undefined);
      }
    }
  }

  /** Draws the remembered groups again after a full redraw (see the module contract). */
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
    // a box that holds a group drawn after it takes that group in, as a redraw of the result would; one whose member group changed follows it
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
    // groups around nothing: after the others, never a member of one (see the contract)
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
    // in the order of the old DI
    for (const g of groups) {
      const drawn = shapes.get(g);
      if (drawn) addTo(drawn.plane, 'planeElement', drawn.shape);
    }
    return result;
  }
}

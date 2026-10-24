/**
 * The ids of DI elements.
 *
 *  - styledId / diStyleOf: the DI id of an element in a style (`<id>_di`,
 *    `BPMNShape_<id>` / `BPMNEdge_<id>` or `Shape_<id>` / `Edge_<id>`), a long
 *    element id cut like the element ids themselves, and the style a DI id
 *    shows. diStyles(defs) is the style most DI of the file uses.
 *  - DiIds (DiIds.ts) gives new DI ids in that style; DiIdMemo (DiIdMemo.ts)
 *    keeps the ids over a full redraw: every BPMNShape / BPMNEdge gets the id
 *    of the old DI element of its element, every BPMNPlane / BPMNDiagram the
 *    ids of the old diagram of the same root (a main diagram whose root
 *    changed, e.g. to a new collaboration, keeps the old ids unless they were
 *    derived from the old root's id like `BPMNPlane_<processId>`, also cut);
 *    DI of elements that had none follows the file's DI id style. A file
 *    without DI (or without shapes and edges showing a style) gets the
 *    engine's form, `BPMNShape_<id>` / `BPMNEdge_<id>` / `BPMNPlane_<root>` /
 *    `BPMNDiagram_<root>`, with a long element id cut like styledId (every DI
 *    id within 64 characters; a taken one gets `_2`, after the ids that need
 *    no cut). An old id is never cut: an old DI id over 64 characters stays.
 *  - followDiIds(defs, el, old, id, ids): an element renamed `old` -> `id`
 *    (`set id=`, a flow that follows its ends) takes its BPMNShape /
 *    BPMNEdge ids along where they were derived from `old` (diStyleOf:
 *    `<old>_di`, `BPMNShape_<old>`, `Edge_<old>`, also cut, also as 0.6
 *    cut them, also with a collision suffix `_2`), `_2` when the new one
 *    is taken; any other DI id stays.
 */
import { cutAt, MAX_ID } from '../../ids/slugs.js';
import { is, type El } from '../../model/utils/moddle.js';
import { idOf, raw, rawList } from './plane.js';

export type Style = 'suffix' | 'bpmn' | 'short';

function styleOf(diId: string, elId: string, kind: 'Shape' | 'Edge'): Style | undefined {
  if (diId === `${elId}_di`) return 'suffix';
  if (diId === `BPMN${kind}_${elId}`) return 'bpmn';
  if (diId === `${kind}_${elId}`) return 'short';
  return undefined;
}

export function allIds(defs: El): Set<string> {
  const ids = new Set<string>();
  const stack: El[] = [defs];
  const seen = new Set<El>();
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    const id = idOf(el);
    if (id) ids.add(id);
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) continue;
    for (const p of descriptor.properties ?? []) {
      if (p.isReference) continue;
      const v = raw<unknown>(el, p.name);
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && '$type' in c) stack.push(c as El);
      } else if (v && typeof v === 'object' && '$type' in v) stack.push(v as El);
    }
  }
  return ids;
}

/** The DI id styles of shapes and edges most DI of the file uses (edges without a style like shapes; undefined: no DI shows one). */
export function diStyles(defs: El): { shape?: Style; edge?: Style } {
  const votes = { Shape: new Map<Style, number>(), Edge: new Map<Style, number>() };
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
      const diId = idOf(pe);
      const elId = idOf(raw(pe, 'bpmnElement'));
      if (!kind || !diId || !elId) continue;
      const style = styleOf(diId, elId, kind);
      if (style) votes[kind].set(style, (votes[kind].get(style) ?? 0) + 1);
    }
  }
  const pick = (m: Map<Style, number>, fallback?: Style): Style | undefined => {
    let best = fallback;
    let n = 0;
    for (const s of ['suffix', 'bpmn', 'short'] as Style[]) {
      const v = m.get(s) ?? 0;
      if (v > n) {
        best = s;
        n = v;
      }
    }
    return best;
  };
  const shape = pick(votes.Shape);
  return { shape, edge: pick(votes.Edge, shape) };
}

/** The longest DI id before a collision suffix (`_99`). */
const MAX_DI = MAX_ID - 3;

/**
 * The DI id of an element in a style (`<id>_di`, `BPMNShape_<id>`,
 * `Edge_<id>`), at most MAX_ID characters less room for a collision suffix:
 * a long element id is cut at a word boundary (src/ids/slugs.ts cutAt), like the
 * element ids themselves. `legacy`: cut as 0.6 cut (recognising the DI ids
 * it wrote).
 */
export function styledId(style: Style, kind: 'Shape' | 'Edge', id: string, legacy = false): string {
  const [head, tail] = style === 'suffix' ? ['', '_di'] : style === 'bpmn' ? [`BPMN${kind}_`, ''] : [`${kind}_`, ''];
  const room = MAX_DI - head.length - tail.length;
  return `${head}${id.length > room ? cutAt(id, room, legacy) : id}${tail}`;
}

/** Whether `diId` is `base` or `base` with the collision suffix claimUnique gives (`_2`, `_3`, ...). */
function isOrSuffixed(diId: string, base: string): boolean {
  return diId === base || (diId.startsWith(`${base}_`) && /^\d+$/.test(diId.slice(base.length + 1)));
}

/** The DI style of a shape's or an edge's id (`<id>_di`, `BPMNShape_<id>`, `Edge_<id>`, also cut by styledId, now or as 0.6 cut, also with a collision suffix `_2`); undefined for any other id. */
export function diStyleOf(diId: string, elId: string, kind: 'Shape' | 'Edge'): Style | undefined {
  return styleOf(diId, elId, kind) ?? (['suffix', 'bpmn', 'short'] as Style[]).find((s) => isOrSuffixed(diId, styledId(s, kind, elId)) || isOrSuffixed(diId, styledId(s, kind, elId, true)));
}

/** The id of the BPMNPlane / BPMNDiagram that shows `root`: `BPMNPlane_<root>`, a long root id cut like styledId (`legacy`: as 0.6 cut it). */
export function rootDiId(kind: 'Plane' | 'Diagram', root: string, legacy = false): string {
  const head = `BPMN${kind}_`;
  return `${head}${cutAt(root, MAX_DI - head.length, legacy)}`;
}

/** Whether `diId` was derived from `root` as the id of its plane / diagram: `BPMNPlane_<root>` uncut (0.6 and the layouter), cut (rootDiId) or as 0.6 cut it. */
export function namesRoot(kind: 'Plane' | 'Diagram', diId: string | undefined, root: string): boolean {
  return diId === `BPMN${kind}_${root}` || diId === rootDiId(kind, root) || diId === rootDiId(kind, root, true);
}

/** Whether every DI id derived from an id of `defs` fits uncut (no id is longer than the room `BPMNDiagram_` leaves): DiIdMemo restore then keeps the engine's ids of a drawing without old DI. */
export function diIdsFit(defs: El): boolean {
  for (const id of allIds(defs)) if (id.length > MAX_DI - 'BPMNDiagram_'.length) return false;
  return true;
}

/** What followDiIds asks and changes: the document's id registry (src/ids/slugs.ts IdRegistry). */
export interface IdClaims {
  has(id: string): boolean;
  claim(id: string): void;
  release(id: string): void;
}

/**
 * The DI of an element renamed `old` -> `id`: each BPMNShape / BPMNEdge of
 * `el` whose id was derived from `old` (diStyleOf, a collision suffix
 * included) takes the id derived from `id` in the same style (styledId),
 * `_2`, `_3`, ... when that one is taken in `ids`, which it updates (as new
 * DI gets its id: claimUnique). A DI id already derived from `id` stays, and
 * so does any other DI id. True when one changed.
 */
export function followDiIds(defs: El, el: El, old: string, id: string, ids: IdClaims): boolean {
  let changed = false;
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      if (raw(pe, 'bpmnElement') !== el) continue;
      const kind = is(pe, 'bpmndi:BPMNShape') ? 'Shape' : is(pe, 'bpmndi:BPMNEdge') ? 'Edge' : undefined;
      const diId = idOf(pe);
      const style = kind && diId ? diStyleOf(diId, old, kind) : undefined;
      if (!kind || !diId || !style) continue;
      const base = styledId(style, kind, id);
      if (isOrSuffixed(diId, base)) continue;
      let next = base;
      for (let i = 2; ids.has(next); i++) next = `${base}_${i}`;
      ids.release(diId);
      ids.claim(next);
      pe.set('id', next);
      changed = true;
    }
  }
  return changed;
}

/** `base`, else `base_2`, `base_3`, ... whichever is not taken; claims it. */
export function claimUnique(taken: Set<string>, base: string): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

/**
 * DI id styles (`<id>_di`, `BPMNShape_<id>`, `Shape_<id>`), so new and renamed DI ids follow the
 * file's style. Every derived id stays within 64 characters; an old id is never cut.
 */
import { cutAt, MAX_ID } from '../../ids/utils/slug.js';
import { is, type El } from '../../model/utils/moddle.js';
import { idOf, raw, rawList } from './raw.js';

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

/** Edges without a style of their own follow the shapes. */
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

const MAX_DI = MAX_ID - 3;

/**
 * A long element id is cut at a word boundary like element ids, leaving room for a collision
 * suffix. `legacy` cuts as 0.6 did, to recognise the DI ids it wrote.
 */
export function styledId(style: Style, kind: 'Shape' | 'Edge', id: string, legacy = false): string {
  const [head, tail] = style === 'suffix' ? ['', '_di'] : style === 'bpmn' ? [`BPMN${kind}_`, ''] : [`${kind}_`, ''];
  const room = MAX_DI - head.length - tail.length;
  return `${head}${id.length > room ? cutAt(id, room, legacy) : id}${tail}`;
}

function isOrSuffixed(diId: string, base: string): boolean {
  return diId === base || (diId.startsWith(`${base}_`) && /^\d+$/.test(diId.slice(base.length + 1)));
}

/** Recognises cut ids (now or as 0.6 cut) and collision suffixes too. */
export function diStyleOf(diId: string, elId: string, kind: 'Shape' | 'Edge'): Style | undefined {
  return styleOf(diId, elId, kind) ?? (['suffix', 'bpmn', 'short'] as Style[]).find((s) => isOrSuffixed(diId, styledId(s, kind, elId)) || isOrSuffixed(diId, styledId(s, kind, elId, true)));
}

export function rootDiId(kind: 'Plane' | 'Diagram', root: string, legacy = false): string {
  const head = `BPMN${kind}_`;
  return `${head}${cutAt(root, MAX_DI - head.length, legacy)}`;
}

export function namesRoot(kind: 'Plane' | 'Diagram', diId: string | undefined, root: string): boolean {
  return diId === `BPMN${kind}_${root}` || diId === rootDiId(kind, root) || diId === rootDiId(kind, root, true);
}

/** Then DiIdMemo keeps the engine's ids for a drawing without old DI. */
export function diIdsFit(defs: El): boolean {
  for (const id of allIds(defs)) if (id.length > MAX_DI - 'BPMNDiagram_'.length) return false;
  return true;
}

export interface IdClaims {
  has(id: string): boolean;
  claim(id: string): void;
  release(id: string): void;
}

/** DI ids derived from `old` follow a rename to `id` in the same style; any other DI id stays. */
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

export function claimUnique(taken: Set<string>, base: string): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

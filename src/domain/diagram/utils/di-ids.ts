/**
 * DI id styles (`<id>_di`, `BPMNShape_<id>`, `Shape_<id>`), so new and renamed DI ids follow the
 * file's style. Every derived id stays within 64 characters; an old id is never cut.
 */
import { cutAt, MAX_ID } from '../../document/utils/slug.js';
import { is, type El } from '../../document/utils/moddle.js';
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
    for (const property of descriptor.properties ?? []) {
      if (property.isReference) continue;
      const value = raw<unknown>(el, property.name);
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && '$type' in child) stack.push(child as El);
      } else if (value && typeof value === 'object' && '$type' in value) stack.push(value as El);
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
  const pick = (styleCounts: Map<Style, number>, fallback?: Style): Style | undefined => {
    let best = fallback;
    let bestCount = 0;
    for (const style of ['suffix', 'bpmn', 'short'] as Style[]) {
      const count = styleCounts.get(style) ?? 0;
      if (count > bestCount) {
        best = style;
        bestCount = count;
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
  return styleOf(diId, elId, kind) ?? (['suffix', 'bpmn', 'short'] as Style[]).find((style) => isOrSuffixed(diId, styledId(style, kind, elId)) || isOrSuffixed(diId, styledId(style, kind, elId, true)));
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
      for (let index = 2; ids.has(next); index++) next = `${base}_${index}`;
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
  for (let index = 2; taken.has(id); index++) id = `${base}_${index}`;
  taken.add(id);
  return id;
}

/**
 * A full redraw keeps the DI ids of the drawing it replaces (audit bug #47).
 *
 * The engines name every DI element after the element it shows
 * (`BPMNShape_<id>`, `BPMNEdge_<id>`, `BPMNPlane_<id>`, `BPMNDiagram_<id>`);
 * a file drawn by another tool uses its own ids (`<id>_di`, `BPMNDiagram_1`).
 * Renaming all of them on a redraw would rewrite every DI line of the file.
 *
 *  - rememberDiIds(defs), before the redraw: the id of the shape / edge of
 *    every element, of the plane showing each root or sub-process and of
 *    that plane's diagram, and an id factory in the file's style (write.ts
 *    diIds); undefined for a file without a drawing (the engine's ids stay).
 *  - keepDiIds(defs, memory), after it: every new DI element gets the id
 *    its element had, DI of an element that had none an id in the file's
 *    style. Nothing is renamed when that would give two elements one id.
 */
import { is, many, walk, type El } from '../model.js';
import { diIds, type DiIds } from './write.js';

export interface DiIdMemory {
  /** element id -> id of its BPMNShape / BPMNEdge */
  shapes: Map<string, string>;
  /** id of a plane's element -> the plane's id and its diagram's id */
  planes: Map<string, { plane?: string; diagram?: string }>;
  /** ids in the file's style for DI that had none */
  factory: DiIds;
}

const idOf = (el: El | undefined): string | undefined => (el ? (el as unknown as { id?: string }).id : undefined);

/** The DI ids of a drawing (see the module header). */
export function rememberDiIds(defs: El): DiIdMemory | undefined {
  const shapes = new Map<string, string>();
  const planes = new Map<string, { plane?: string; diagram?: string }>();
  for (const diagram of many(defs, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    const root = idOf(plane?.get<El | undefined>('bpmnElement'));
    if (root && !planes.has(root)) planes.set(root, { plane: idOf(plane), diagram: idOf(diagram) });
    for (const pe of plane ? many(plane, 'planeElement') : []) {
      const target = idOf(pe.get<El | undefined>('bpmnElement'));
      const id = idOf(pe);
      if (target && id && !shapes.has(target)) shapes.set(target, id);
    }
  }
  if (!shapes.size) return undefined;
  return { shapes, planes, factory: diIds(defs) };
}

/** Gives the DI of a redrawn model the remembered ids; returns how many changed. */
export function keepDiIds(defs: El, memory: DiIdMemory): number {
  const wanted = new Map<El, string>();
  const want = (el: El | undefined, id: string | undefined): void => {
    if (el && id && idOf(el) !== id) wanted.set(el, id);
  };
  for (const diagram of many(defs, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    const root = idOf(plane?.get<El | undefined>('bpmnElement'));
    const kept = root ? memory.planes.get(root) : undefined;
    want(plane, kept?.plane);
    want(diagram, kept?.diagram);
    for (const pe of plane ? many(plane, 'planeElement') : []) {
      const target = idOf(pe.get<El | undefined>('bpmnElement'));
      if (!target) continue;
      const own = memory.shapes.get(target);
      want(pe, own ?? (is(pe, 'bpmndi:BPMNEdge') ? memory.factory.edge(target) : is(pe, 'bpmndi:BPMNShape') ? memory.factory.shape(target) : undefined));
    }
  }
  if (!wanted.size) return 0;
  // the ids after the renaming must stay unique
  const count = new Map<string, number>();
  for (const el of walk(defs)) {
    const id = wanted.get(el) ?? idOf(el);
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  if ([...wanted.values()].some((id) => count.get(id) !== 1)) return 0;
  for (const [el, id] of wanted) el.set('id', id);
  return wanted.size;
}

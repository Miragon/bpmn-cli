import type { BpmnElement } from '../document/BpmnElement.js';
import { ElementWalk } from '../document/ElementWalk.js';
import { IdCut } from '../ids/IdCut.js';

export type DrawingIdPattern = 'suffix' | 'bpmn' | 'short';

export type PlaneElementKind = 'Shape' | 'Edge';

export type DrawingRootKind = 'Plane' | 'Diagram';

export interface DrawingIdPatterns {
  shape?: DrawingIdPattern | undefined;
  edge?: DrawingIdPattern | undefined;
}

export interface IdClaims {
  has(id: string): boolean;
  claim(id: string): void;
  release(id: string): void;
}

export class DrawingIdStyle {
  private static readonly STYLES: readonly DrawingIdPattern[] = ['suffix', 'bpmn', 'short'];
  private static readonly MAX_DRAWING_ID = IdCut.MAX_ID - 3;

  static allIds(definitions: BpmnElement): Set<string> {
    const ids = new Set<string>();
    for (const element of new ElementWalk(definitions).stored()) {
      const id = element.peek<string>('id');
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  }

  static stylesOf(definitions: BpmnElement): DrawingIdPatterns {
    const votes = { Shape: new Map<DrawingIdPattern, number>(), Edge: new Map<DrawingIdPattern, number>() };
    for (const planeElement of DrawingIdStyle.planeElements(definitions)) {
      const kind = DrawingIdStyle.kindOf(planeElement);
      const planeElementId = planeElement.peek<string>('id');
      const elementId = planeElement.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
      const style = kind && planeElementId && elementId ? DrawingIdStyle.styleOf(planeElementId, elementId, kind) : undefined;
      if (kind && style) {
        votes[kind].set(style, (votes[kind].get(style) ?? 0) + 1);
      }
    }
    const shape = DrawingIdStyle.pick(votes.Shape);
    return { shape, edge: DrawingIdStyle.pick(votes.Edge, shape) };
  }

  static styledId(style: DrawingIdPattern, kind: PlaneElementKind, id: string): string {
    const [head, tail] = DrawingIdStyle.frame(style, kind);
    const room = DrawingIdStyle.MAX_DRAWING_ID - head.length - tail.length;
    return `${head}${id.length > room ? IdCut.cutAt(id, room) : id}${tail}`;
  }

  static rootDrawingId(kind: DrawingRootKind, root: string): string {
    const head = `BPMN${kind}_`;
    return `${head}${IdCut.cutAt(root, DrawingIdStyle.MAX_DRAWING_ID - head.length)}`;
  }

  static namesRoot(kind: DrawingRootKind, drawingId: string | undefined, root: string): boolean {
    return drawingId === `BPMN${kind}_${root}` || drawingId === DrawingIdStyle.rootDrawingId(kind, root);
  }

  static kindOf(planeElement: BpmnElement): PlaneElementKind | undefined {
    if (planeElement.is('bpmndi:BPMNShape')) {
      return 'Shape';
    }
    return planeElement.is('bpmndi:BPMNEdge') ? 'Edge' : undefined;
  }

  static followRename(definitions: BpmnElement, element: BpmnElement, oldId: string, id: string, claims: IdClaims): boolean {
    let changed = false;
    for (const planeElement of DrawingIdStyle.planeElements(definitions)) {
      if (planeElement.peek('bpmnElement') === element && DrawingIdStyle.follow(planeElement, oldId, id, claims)) {
        changed = true;
      }
    }
    return changed;
  }

  static claimUnique(taken: Set<string>, base: string): string {
    let id = base;
    for (let index = 2; taken.has(id); index++) {
      id = `${base}_${index}`;
    }
    taken.add(id);
    return id;
  }

  private static planeElements(definitions: BpmnElement): BpmnElement[] {
    return definitions.list('diagrams').flatMap((diagram) => diagram.peek<BpmnElement>('plane')?.list('planeElement') ?? []);
  }

  private static frame(style: DrawingIdPattern, kind: PlaneElementKind): [string, string] {
    if (style === 'suffix') {
      return ['', '_di'];
    }
    return style === 'bpmn' ? [`BPMN${kind}_`, ''] : [`${kind}_`, ''];
  }

  private static styleOf(planeElementId: string, elementId: string, kind: PlaneElementKind): DrawingIdPattern | undefined {
    return DrawingIdStyle.STYLES.find((style) => planeElementId === DrawingIdStyle.frame(style, kind).join(elementId));
  }

  private static pick(counts: Map<DrawingIdPattern, number>, fallback?: DrawingIdPattern): DrawingIdPattern | undefined {
    let best = fallback;
    let bestCount = 0;
    for (const style of DrawingIdStyle.STYLES) {
      const count = counts.get(style) ?? 0;
      if (count > bestCount) {
        best = style;
        bestCount = count;
      }
    }
    return best;
  }

  private static isOrSuffixed(planeElementId: string, base: string): boolean {
    return planeElementId === base || (planeElementId.startsWith(`${base}_`) && /^\d+$/.test(planeElementId.slice(base.length + 1)));
  }

  private static recognisedStyle(planeElementId: string, elementId: string, kind: PlaneElementKind): DrawingIdPattern | undefined {
    return DrawingIdStyle.styleOf(planeElementId, elementId, kind) ?? DrawingIdStyle.STYLES.find((style) => DrawingIdStyle.isOrSuffixed(planeElementId, DrawingIdStyle.styledId(style, kind, elementId)));
  }

  private static follow(planeElement: BpmnElement, oldId: string, id: string, claims: IdClaims): boolean {
    const kind = DrawingIdStyle.kindOf(planeElement);
    const planeElementId = planeElement.peek<string>('id');
    const style = kind && planeElementId ? DrawingIdStyle.recognisedStyle(planeElementId, oldId, kind) : undefined;
    if (!kind || !planeElementId || !style) {
      return false;
    }
    const base = DrawingIdStyle.styledId(style, kind, id);
    if (DrawingIdStyle.isOrSuffixed(planeElementId, base)) {
      return false;
    }
    let next = base;
    for (let index = 2; claims.has(next); index++) {
      next = `${base}_${index}`;
    }
    claims.release(planeElementId);
    claims.claim(next);
    planeElement.set('id', next);
    return true;
  }
}

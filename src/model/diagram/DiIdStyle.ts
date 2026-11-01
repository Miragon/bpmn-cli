import type { BpmnElement } from '../document/BpmnElement.js';
import { ElementWalk } from '../document/ElementWalk.js';
import { IdCut } from '../ids/IdCut.js';

export type DiStyle = 'suffix' | 'bpmn' | 'short';

export type DiKind = 'Shape' | 'Edge';

export type DiRootKind = 'Plane' | 'Diagram';

export interface DiStyles {
  shape?: DiStyle | undefined;
  edge?: DiStyle | undefined;
}

export interface IdClaims {
  has(id: string): boolean;
  claim(id: string): void;
  release(id: string): void;
}

export class DiIdStyle {
  private static readonly STYLES: readonly DiStyle[] = ['suffix', 'bpmn', 'short'];
  private static readonly MAX_DI = IdCut.MAX_ID - 3;

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

  static stylesOf(definitions: BpmnElement): DiStyles {
    const votes = { Shape: new Map<DiStyle, number>(), Edge: new Map<DiStyle, number>() };
    for (const planeElement of DiIdStyle.planeElements(definitions)) {
      const kind = DiIdStyle.kindOf(planeElement);
      const diId = planeElement.peek<string>('id');
      const elementId = planeElement.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
      const style = kind && diId && elementId ? DiIdStyle.styleOf(diId, elementId, kind) : undefined;
      if (kind && style) {
        votes[kind].set(style, (votes[kind].get(style) ?? 0) + 1);
      }
    }
    const shape = DiIdStyle.pick(votes.Shape);
    return { shape, edge: DiIdStyle.pick(votes.Edge, shape) };
  }

  static styledId(style: DiStyle, kind: DiKind, id: string): string {
    const [head, tail] = DiIdStyle.frame(style, kind);
    const room = DiIdStyle.MAX_DI - head.length - tail.length;
    return `${head}${id.length > room ? IdCut.cutAt(id, room) : id}${tail}`;
  }

  static rootDiId(kind: DiRootKind, root: string): string {
    const head = `BPMN${kind}_`;
    return `${head}${IdCut.cutAt(root, DiIdStyle.MAX_DI - head.length)}`;
  }

  static namesRoot(kind: DiRootKind, diId: string | undefined, root: string): boolean {
    return diId === `BPMN${kind}_${root}` || diId === DiIdStyle.rootDiId(kind, root);
  }

  static kindOf(planeElement: BpmnElement): DiKind | undefined {
    if (planeElement.is('bpmndi:BPMNShape')) {
      return 'Shape';
    }
    return planeElement.is('bpmndi:BPMNEdge') ? 'Edge' : undefined;
  }

  static followRename(definitions: BpmnElement, element: BpmnElement, oldId: string, id: string, claims: IdClaims): boolean {
    let changed = false;
    for (const planeElement of DiIdStyle.planeElements(definitions)) {
      if (planeElement.peek('bpmnElement') === element && DiIdStyle.follow(planeElement, oldId, id, claims)) {
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

  private static frame(style: DiStyle, kind: DiKind): [string, string] {
    if (style === 'suffix') {
      return ['', '_di'];
    }
    return style === 'bpmn' ? [`BPMN${kind}_`, ''] : [`${kind}_`, ''];
  }

  private static styleOf(diId: string, elementId: string, kind: DiKind): DiStyle | undefined {
    return DiIdStyle.STYLES.find((style) => diId === DiIdStyle.frame(style, kind).join(elementId));
  }

  private static pick(counts: Map<DiStyle, number>, fallback?: DiStyle): DiStyle | undefined {
    let best = fallback;
    let bestCount = 0;
    for (const style of DiIdStyle.STYLES) {
      const count = counts.get(style) ?? 0;
      if (count > bestCount) {
        best = style;
        bestCount = count;
      }
    }
    return best;
  }

  private static isOrSuffixed(diId: string, base: string): boolean {
    return diId === base || (diId.startsWith(`${base}_`) && /^\d+$/.test(diId.slice(base.length + 1)));
  }

  private static recognisedStyle(diId: string, elementId: string, kind: DiKind): DiStyle | undefined {
    return DiIdStyle.styleOf(diId, elementId, kind) ?? DiIdStyle.STYLES.find((style) => DiIdStyle.isOrSuffixed(diId, DiIdStyle.styledId(style, kind, elementId)));
  }

  private static follow(planeElement: BpmnElement, oldId: string, id: string, claims: IdClaims): boolean {
    const kind = DiIdStyle.kindOf(planeElement);
    const diId = planeElement.peek<string>('id');
    const style = kind && diId ? DiIdStyle.recognisedStyle(diId, oldId, kind) : undefined;
    if (!kind || !diId || !style) {
      return false;
    }
    const base = DiIdStyle.styledId(style, kind, id);
    if (DiIdStyle.isOrSuffixed(diId, base)) {
      return false;
    }
    let next = base;
    for (let index = 2; claims.has(next); index++) {
      next = `${base}_${index}`;
    }
    claims.release(diId);
    claims.claim(next);
    planeElement.set('id', next);
    return true;
  }
}

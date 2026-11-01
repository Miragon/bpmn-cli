import type { BpmnElement } from '../document/BpmnElement.js';
import { DiIdStyle, type DiKind, type DiRootKind, type DiStyles } from './DiIdStyle.js';

interface DiagramMemo {
  root?: string | undefined;
  plane?: string | undefined;
  diagram?: string | undefined;
}

export class DiIdMemo {
  readonly shapes = new Map<string, string>();
  readonly edges = new Map<string, string>();
  readonly diagrams: DiagramMemo[] = [];

  private constructor(readonly styles: DiStyles) {}

  static remember(definitions: BpmnElement): DiIdMemo {
    const memo = new DiIdMemo(DiIdStyle.stylesOf(definitions));
    for (const diagram of definitions.list('diagrams')) {
      const plane = diagram.peek<BpmnElement>('plane');
      memo.diagrams.push({ root: plane?.peek<BpmnElement>('bpmnElement')?.peek<string>('id'), plane: plane?.peek<string>('id'), diagram: diagram.peek<string>('id') });
      for (const planeElement of plane?.list('planeElement') ?? []) {
        memo.rememberPlaneElement(planeElement);
      }
    }
    return memo;
  }

  private static elementIdOf(planeElement: BpmnElement): string | undefined {
    return planeElement.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
  }

  private static rootId(kind: DiRootKind, element: BpmnElement, root: string | undefined): string {
    return root ? DiIdStyle.rootDiId(kind, root) : (element.peek<string>('id') ?? `BPMN${kind}_1`);
  }

  private static derived(memo: DiagramMemo): boolean {
    return !!memo.root && (DiIdStyle.namesRoot('Plane', memo.plane, memo.root) || DiIdStyle.namesRoot('Diagram', memo.diagram, memo.root));
  }

  restore(definitions: BpmnElement): void {
    const diagrams = definitions.list('diagrams');
    const taken = DiIdMemo.idsOutsideDi(definitions, diagrams);
    const fresh: Array<{ element: BpmnElement; base: string }> = [];
    const claim = (element: BpmnElement, wanted: string | undefined, base: string): void => {
      if (wanted && !taken.has(wanted)) {
        taken.add(wanted);
        element.set('id', wanted);
      } else {
        fresh.push({ element, base });
      }
    };
    this.restoreDiagrams(diagrams, claim);
    for (const planeElement of diagrams.flatMap((diagram) => diagram.peek<BpmnElement>('plane')?.list('planeElement') ?? [])) {
      this.restorePlaneElement(planeElement, claim);
    }
    const isUncut = ({ element, base }: { element: BpmnElement; base: string }): boolean => element.peek('id') === base;
    for (const { element, base } of [...fresh.filter(isUncut), ...fresh.filter((candidate) => !isUncut(candidate))]) {
      element.set('id', DiIdStyle.claimUnique(taken, base));
    }
  }

  private static idsOutsideDi(definitions: BpmnElement, diagrams: readonly BpmnElement[]): Set<string> {
    const taken = DiIdStyle.allIds(definitions);
    for (const diagram of diagrams) {
      const plane = diagram.peek<BpmnElement>('plane');
      for (const element of [diagram, ...(plane ? [plane] : []), ...(plane?.list('planeElement') ?? [])]) {
        const id = element.peek<string>('id');
        if (id) {
          taken.delete(id);
        }
      }
    }
    return taken;
  }

  private rememberPlaneElement(planeElement: BpmnElement): void {
    const diId = planeElement.peek<string>('id');
    const elementId = DiIdMemo.elementIdOf(planeElement);
    const kind = DiIdStyle.kindOf(planeElement);
    if (!diId || !elementId || !kind) {
      return;
    }
    const into = kind === 'Shape' ? this.shapes : this.edges;
    if (!into.has(elementId)) {
      into.set(elementId, diId);
    }
  }

  private restoreDiagrams(diagrams: readonly BpmnElement[], claim: (element: BpmnElement, wanted: string | undefined, base: string) => void): void {
    const old = [...this.diagrams];
    const main = old[0];
    const claimRoots = (diagram: BpmnElement, memo: DiagramMemo | undefined): void => {
      const plane = diagram.peek<BpmnElement>('plane');
      const root = plane?.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
      if (plane) {
        claim(plane, memo?.plane, DiIdMemo.rootId('Plane', plane, root));
      }
      claim(diagram, memo?.diagram, DiIdMemo.rootId('Diagram', diagram, root));
    };
    const unmatched: BpmnElement[] = [];
    for (const diagram of diagrams) {
      const root = diagram.peek<BpmnElement>('plane')?.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
      const index = old.findIndex((memo) => memo.root === root);
      if (index === -1) {
        unmatched.push(diagram);
      } else {
        claimRoots(diagram, old.splice(index, 1)[0]);
      }
    }
    for (const diagram of unmatched) {
      const reused = diagram === diagrams[0] && main && old.includes(main) && !DiIdMemo.derived(main) ? main : undefined;
      if (reused) {
        old.splice(old.indexOf(reused), 1);
      }
      claimRoots(diagram, reused);
    }
  }

  private restorePlaneElement(planeElement: BpmnElement, claim: (element: BpmnElement, wanted: string | undefined, base: string) => void): void {
    const elementId = DiIdMemo.elementIdOf(planeElement);
    const kind: DiKind | undefined = DiIdStyle.kindOf(planeElement);
    if (!elementId || !kind) {
      return;
    }
    const wanted = (kind === 'Shape' ? this.shapes : this.edges).get(elementId);
    const style = kind === 'Shape' ? this.styles.shape : this.styles.edge;
    claim(planeElement, wanted, DiIdStyle.styledId(style ?? 'bpmn', kind, elementId));
  }
}

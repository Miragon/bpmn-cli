import type { BpmnElement, BpmnTree } from '../../model/index.js';
import { Swatches } from './Swatches.js';

export interface ColorAttributes {
  own: Record<string, string>;
  label: Record<string, string>;
}

export class DiagramColors {
  constructor(private readonly tree: BpmnTree) {}

  private static elementIdOf(planeElement: BpmnElement): string | undefined {
    return planeElement.peek<BpmnElement>('bpmnElement')?.peek<string>('id');
  }

  read(): Map<string, ColorAttributes> {
    const colors = new Map<string, ColorAttributes>();
    for (const planeElement of this.planeElements()) {
      const id = DiagramColors.elementIdOf(planeElement);
      if (id) {
        const own = Swatches.colorsOf(planeElement, planeElement.is('bpmndi:BPMNEdge') ? Swatches.EDGE_COLORS : Swatches.SHAPE_COLORS);
        const label = Swatches.colorsOf(planeElement.peek<BpmnElement>('label'), Swatches.LABEL_COLORS);
        if (Object.keys(own).length || Object.keys(label).length) {
          colors.set(id, { own, label });
        }
      }
    }
    return colors;
  }

  apply(colors: ReadonlyMap<string, ColorAttributes>): void {
    for (const planeElement of colors.size ? this.planeElements() : []) {
      const elementColors = colors.get(DiagramColors.elementIdOf(planeElement) ?? '');
      if (elementColors) {
        Object.entries(elementColors.own).forEach(([key, value]) => planeElement.set(key, value));
        this.applyToLabel(planeElement, elementColors.label);
      }
    }
  }

  private planeElements(): BpmnElement[] {
    return this.tree.definitions.list('diagrams').flatMap((diagram) => diagram.peek<BpmnElement>('plane')?.list('planeElement') ?? []);
  }

  private applyToLabel(planeElement: BpmnElement, colors: Record<string, string>): void {
    if (!Object.keys(colors).length) {
      return;
    }
    let label = planeElement.peek<BpmnElement>('label');
    if (!label) {
      label = this.tree.build('bpmndi:BPMNLabel');
      planeElement.set('label', label);
      label.parent = planeElement;
    }
    for (const [key, value] of Object.entries(colors)) {
      label.set(key, value);
    }
  }
}

import type { BpmnElement } from '../../model/index.js';

export type SwatchName = 'blue' | 'orange' | 'green' | 'red' | 'purple';

export class Swatches {
  static readonly SHAPE_COLORS: readonly string[] = ['bioc:stroke', 'bioc:fill', 'color:background-color', 'color:border-color'];
  static readonly EDGE_COLORS: readonly string[] = ['bioc:stroke', 'bioc:fill', 'color:border-color'];
  static readonly LABEL_COLORS: readonly string[] = ['color:color'];
  static readonly TABLE: Readonly<Record<SwatchName, { fill: string; stroke: string }>> = {
    blue: { fill: '#bbdefb', stroke: '#0d4372' },
    orange: { fill: '#ffe0b2', stroke: '#6b3c00' },
    green: { fill: '#c8e6c9', stroke: '#205022' },
    red: { fill: '#ffcdd2', stroke: '#831311' },
    purple: { fill: '#e1bee7', stroke: '#5b176d' },
  };

  static colorsOf(element: BpmnElement | undefined, keys: readonly string[]): Record<string, string> {
    const colors: Record<string, string> = {};
    for (const key of element ? keys : []) {
      const value = element!.get<string | undefined>(key);
      if (typeof value === 'string' && value) {
        colors[key] = value;
      }
    }
    return colors;
  }

  static set(planeElement: BpmnElement, swatch: SwatchName | undefined): boolean {
    const before = Swatches.fingerprint(planeElement);
    const label = planeElement.peek<BpmnElement>('label');
    for (const key of new Set([...Swatches.SHAPE_COLORS, ...Swatches.EDGE_COLORS])) {
      planeElement.set(key, undefined);
    }
    label?.set('color:color', undefined);
    if (swatch) {
      Swatches.paint(planeElement, label, Swatches.TABLE[swatch]);
    }
    return Swatches.fingerprint(planeElement) !== before;
  }

  private static fingerprint(planeElement: BpmnElement): string {
    return JSON.stringify([Swatches.colorsOf(planeElement, [...Swatches.SHAPE_COLORS, ...Swatches.EDGE_COLORS]), Swatches.colorsOf(planeElement.peek<BpmnElement>('label'), Swatches.LABEL_COLORS)]);
  }

  private static paint(planeElement: BpmnElement, label: BpmnElement | undefined, { fill, stroke }: { fill: string; stroke: string }): void {
    planeElement.set('bioc:stroke', stroke);
    planeElement.set('color:border-color', stroke);
    if (!planeElement.is('bpmndi:BPMNEdge')) {
      planeElement.set('bioc:fill', fill);
      planeElement.set('color:background-color', fill);
    }
    label?.set('color:color', stroke);
  }
}

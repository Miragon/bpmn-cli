import type { BpmnElement } from '../../model/index.js';
import type { ColorOperation } from '../../operations/index.js';
import { Swatches } from '../diagram/Swatches.js';
import type { DrawnDiagram } from './DrawnDiagram.js';

export class ElementColoring {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly operation: ColorOperation,
  ) {}

  run(): string[] {
    const swatch = this.operation.color === 'default' ? undefined : this.operation.color;
    const colored = [...new Set(this.operation.ids)].filter((id) => Swatches.set(this.planeElementOf(id), swatch));
    if (swatch && colored.length) {
      this.diagram.document.namespaces.declare('bioc');
      this.diagram.document.namespaces.declare('color');
    }
    return colored;
  }

  private planeElementOf(id: string): BpmnElement {
    const { document, planes } = this.diagram;
    const element = document.tree.require(id);
    if (!planes.length) {
      throw this.diagram.noDiagram();
    }
    const planeElement = planes.map((plane) => plane.shapes.get(id)?.planeElement ?? plane.edges.get(id)?.planeElement).find((found) => !!found);
    if (!planeElement) {
      throw this.diagram.noShape(element, id, 'shape or connection');
    }
    return planeElement;
  }
}

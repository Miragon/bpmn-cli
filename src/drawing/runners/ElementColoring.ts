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
    const colored = [...new Set(this.operation.ids)].filter((id) => Swatches.set(this.diOf(id), swatch));
    if (swatch && colored.length) {
      this.diagram.document.namespaces.declare('bioc');
      this.diagram.document.namespaces.declare('color');
    }
    return colored;
  }

  private diOf(id: string): BpmnElement {
    const { document, planes } = this.diagram;
    const element = document.tree.require(id);
    if (!planes.length) {
      throw this.diagram.noDiagram();
    }
    const di = planes.map((plane) => plane.shapes.get(id)?.di ?? plane.edges.get(id)?.di).find((found) => !!found);
    if (!di) {
      throw this.diagram.noShape(element, id, 'shape or connection');
    }
    return di;
  }
}

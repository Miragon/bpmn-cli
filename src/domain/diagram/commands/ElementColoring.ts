import type { ColorElements } from '../../commands/types.js';
import { setSwatch } from '../utils/colors.js';
import { unique } from '../utils/shape-sets.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

export class ElementColoring {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: ColorElements,
  ) {}

  run(): string[] {
    const colored: string[] = [];
    const swatch = this.command.color === 'default' ? undefined : this.command.color;
    for (const id of unique(this.command.ids ?? [])) {
      const el = this.diagram.doc.require(id);
      if (!this.diagram.planes.length) throw this.diagram.noDiagram();
      const shape = this.diagram.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found);
      const edge = shape ? undefined : this.diagram.planes.map((plane) => plane.edges.get(id)).find((found) => !!found);
      const di = shape?.di ?? edge?.di;
      if (!di) throw this.diagram.noShape(el, id, 'shape or connection');
      if (setSwatch(di, swatch)) colored.push(id);
    }
    if (swatch && colored.length) {
      this.diagram.doc.declareNamespace('bioc');
      this.diagram.doc.declareNamespace('color');
    }
    return colored;
  }
}

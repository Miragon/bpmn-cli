import type { ColorElements } from '../../commands/types.js';
import { setSwatch } from '../utils/colors.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';
import { unique } from '../utils/frames.js';

export class ColoringService {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly op: ColorElements,
  ) {}

  run(): string[] {
    const colored: string[] = [];
    const swatch = this.op.color === 'default' ? undefined : this.op.color;
    for (const id of unique(this.op.ids ?? [])) {
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

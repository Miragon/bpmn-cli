import type { ColorOp } from '../ops/types.js';
import { setSwatch } from '../drawing/utils/colors.js';
import type { FormatOps } from './FormatOps.js';
import { unique } from './utils/frames.js';

export class ColorAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: ColorOp,
  ) {}

  run(): string[] {
    const colored: string[] = [];
    const swatch = this.op.color === 'default' ? undefined : this.op.color;
    for (const id of unique(this.op.ids ?? [])) {
      const el = this.ops.doc.require(id);
      if (!this.ops.planes.length) throw this.ops.noDiagram();
      const shape = this.ops.planes.map((plane) => plane.shapes.get(id)).find((found) => !!found);
      const edge = shape ? undefined : this.ops.planes.map((plane) => plane.edges.get(id)).find((found) => !!found);
      const di = shape?.di ?? edge?.di;
      if (!di) throw this.ops.noShape(el, id, 'shape or connection');
      if (setSwatch(di, swatch)) colored.push(id);
    }
    if (swatch && colored.length) {
      this.ops.doc.declareNamespace('bioc');
      this.ops.doc.declareNamespace('color');
    }
    return colored;
  }
}

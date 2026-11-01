import type { BpmnNode } from '../read/index.js';
import { Svg } from './Svg.js';

export class Style {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
  readonly filled: boolean;

  constructor(di: BpmnNode) {
    const fill = Style.color(di, 'color:background-color') ?? Style.color(di, 'bioc:fill');
    this.stroke = Style.color(di, 'color:border-color') ?? Style.color(di, 'bioc:stroke') ?? Svg.STROKE;
    this.label = Style.color(di.ref('label'), 'color:color') ?? this.stroke;
    this.fill = fill ?? Svg.FILL;
    this.filled = !!fill;
  }

  private static color(node: BpmnNode | undefined, key: string): string | undefined {
    const candidate = node?.attribute(key);
    if (typeof candidate !== 'string') {
      return undefined;
    }
    const color = candidate.trim();
    return /^#[0-9a-f]{3,8}$/i.test(color) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(color) || /^[a-z]{3,30}$/i.test(color) ? color : undefined;
  }
}

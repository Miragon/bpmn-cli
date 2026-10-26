import { raw } from '../drawing/utils/raw.js';
import type { El } from '../model/utils/moddle.js';
import { FILL, STROKE } from './utils/svg.js';

/** The colour attributes of a DI element as bpmn-js reads them: color: first, then bioc:. */
export class Style {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
  readonly filled: boolean;

  constructor(di: El | undefined) {
    const fill = Style.colorAttr(di, 'color:background-color') ?? Style.colorAttr(di, 'bioc:fill');
    this.stroke = Style.colorAttr(di, 'color:border-color') ?? Style.colorAttr(di, 'bioc:stroke') ?? STROKE;
    this.label = Style.colorAttr(raw<El>(di, 'label'), 'color:color') ?? this.stroke;
    this.fill = fill ?? FILL;
    this.filled = !!fill;
  }

  private static colorAttr(el: El | undefined, key: string): string | undefined {
    if (!el) return undefined;
    const get = (el as { get?: (attributeKey: string) => unknown }).get;
    return Style.safeColor(typeof get === 'function' ? get.call(el, key) : undefined);
  }

  private static safeColor(candidate: unknown): string | undefined {
    if (typeof candidate !== 'string') return undefined;
    const color = candidate.trim();
    return /^#[0-9a-f]{3,8}$/i.test(color) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(color) || /^[a-z]{3,30}$/i.test(color) ? color : undefined;
  }
}

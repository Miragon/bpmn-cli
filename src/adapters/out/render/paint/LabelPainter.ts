import { cx } from '../../../../domain/diagram/utils/geom.js';
import type { Box, Point } from '../../../../domain/diagram/utils/geom.js';
import { textWidth, wrapLines } from '../../../../domain/diagram/utils/text.js';
import { LAYER, type Item } from '../types.js';
import { attr, lines, SIZE } from '../utils/svg.js';

/** external labels (bpmn-js: 11 px, 90 px wide, line height 1.2) */
const EXT_SIZE = 11;
const EXT_WIDTH = 90;
const EXT_LINE = EXT_SIZE * 1.2;

export class LabelPainter {
  constructor(private readonly color: string) {}

  /**
   * Like bpmn-js 18: laid out at max(90, the DI label width), then again at the width of its
   * widest line (plus a hair of slack, so it fits despite rounding), which can break it differently.
   */
  external(id: string, value: string, cx: number, top: number, labelWidth = EXT_WIDTH): Item {
    const scale = SIZE / EXT_SIZE;
    const first = wrapLines(value, Math.max(EXT_WIDTH, labelWidth) * scale);
    const widest = Math.ceil(Math.max(...first.map((line) => textWidth(line) / scale)) - 1e-9);
    const ls = wrapLines(value, widest * scale + 1e-6);
    const width = Math.max(...ls.map((line) => textWidth(line) / scale), 1);
    return {
      box: { x: cx - width / 2, y: top, width, height: ls.length * EXT_LINE },
      layer: LAYER.label,
      svg: lines(ls, cx, top + EXT_LINE * 0.75, EXT_SIZE, this.color, 'middle', ` data-label="${attr(id)}"`),
    };
  }

  message(id: string, value: string, anchor: Point): Item {
    const ls = wrapLines(value, 150);
    const width = Math.max(...ls.map((line) => textWidth(line)), 1);
    const top = anchor.y + 10;
    return {
      box: { x: anchor.x, y: top, width, height: ls.length * SIZE * 1.2 },
      layer: LAYER.label,
      svg: lines(ls, anchor.x + width / 2, top + SIZE * 1.2 * 0.75, SIZE, this.color, 'middle', ` data-message="${attr(id)}"`),
    };
  }

  /** Like diagram-js Text: the first baseline 3/4 of a line below the text's top. */
  inBox(value: string, box: Box, horizontal: 'center' | 'left', vertical: 'top' | 'middle', padding: number, transform = ''): string {
    const ls = wrapLines(value, box.width - 2 * padding);
    const step = SIZE * 1.2;
    const pad = vertical === 'middle' ? 0 : padding;
    const top = pad + (vertical === 'middle' ? (box.height - ls.length * step) / 2 : 0);
    const left = horizontal === 'left' ? box.x + padding : cx(box);
    return lines(ls, left, box.y + top + step * 0.75, SIZE, this.color, horizontal === 'left' ? 'start' : 'middle', transform);
  }
}

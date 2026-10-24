import type { Box, Point } from '../diagram/utils/geom.js';
import { textWidth, wrapLines } from '../diagram/utils/text.js';
import { LAYER, type Item } from './types.js';
import { attr, lines, SIZE } from './utils/svg.js';

/** external labels (bpmn-js: 11 px, 90 px wide, line height 1.2) */
const EXT_SIZE = 11;
const EXT_WIDTH = 90;
const EXT_LINE = EXT_SIZE * 1.2;

export class LabelPainter {
  constructor(private readonly color: string) {}

  /**
   * An external label like bpmn-js 18 (BpmnImporter.addLabel, then
   * renderExternalLabel): the text laid out at max(90, the DI label width) in
   * 11 px, then again at the width of its widest line (rounded up), which can
   * break it differently; centred on `cx`, its top at `top` (data-label: the
   * element's id).
   */
  external(id: string, value: string, cx: number, top: number, labelWidth = EXT_WIDTH): Item {
    const k = SIZE / EXT_SIZE;
    const first = wrapLines(value, Math.max(EXT_WIDTH, labelWidth) * k);
    const widest = Math.ceil(Math.max(...first.map((l) => textWidth(l) / k)) - 1e-9);
    // (a hair of slack: the widest line fits its own width despite rounding)
    const ls = wrapLines(value, widest * k + 1e-6);
    const width = Math.max(...ls.map((l) => textWidth(l) / k), 1);
    return {
      box: { x: cx - width / 2, y: top, width, height: ls.length * EXT_LINE },
      layer: LAYER.label,
      svg: lines(ls, cx, top + EXT_LINE * 0.75, EXT_SIZE, this.color, 'middle', ` data-label="${attr(id)}"`),
    };
  }

  message(id: string, value: string, m: Point): Item {
    const ls = wrapLines(value, 150);
    const width = Math.max(...ls.map((l) => textWidth(l)), 1);
    const top = m.y + 10;
    return {
      box: { x: m.x, y: top, width, height: ls.length * SIZE * 1.2 },
      layer: LAYER.label,
      svg: lines(ls, m.x + width / 2, top + SIZE * 1.2 * 0.75, SIZE, this.color, 'middle', ` data-message="${attr(id)}"`),
    };
  }

  /**
   * diagram-js Text in a box: wrapped at the box width minus the padding,
   * horizontally centred or left, vertically at the top (padding) or centred
   * (no padding), the first baseline 3/4 of a line below the text's top.
   */
  inBox(value: string, box: Box, h: 'center' | 'left', v: 'top' | 'middle', padding: number, transform = ''): string {
    const ls = wrapLines(value, box.width - 2 * padding);
    const step = SIZE * 1.2;
    const pad = v === 'middle' ? 0 : padding;
    const top = pad + (v === 'middle' ? (box.height - ls.length * step) / 2 : 0);
    const x = h === 'left' ? box.x + padding : box.x + box.width / 2;
    return lines(ls, x, box.y + top + step * 0.75, SIZE, this.color, h === 'left' ? 'start' : 'middle', transform);
  }
}

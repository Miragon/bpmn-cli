import { Box, type Point } from '../read/index.js';
import { TextMetrics } from '../text/index.js';
import { Svg } from './Svg.js';

export interface PaintedLabel {
  box: Box;
  svg: string;
}

export interface LabelPlacement {
  horizontal: 'center' | 'left';
  vertical: 'top' | 'middle';
  padding: number;
  transform?: string;
}

export class LabelPainter {
  private static readonly EXTERNAL_SIZE = 11;
  private static readonly EXTERNAL_WIDTH = 90;
  private static readonly MESSAGE_WIDTH = 150;
  private static readonly LINE_FACTOR = 1.2;
  private static readonly FIRST_BASELINE = 0.75;

  constructor(private readonly color: string) {}

  external(id: string, value: string, centerX: number, top: number, labelWidth = LabelPainter.EXTERNAL_WIDTH): PaintedLabel {
    const line = LabelPainter.EXTERNAL_SIZE * LabelPainter.LINE_FACTOR;
    const scale = Svg.FONT_SIZE / LabelPainter.EXTERNAL_SIZE;
    const first = TextMetrics.wrap(value, Math.max(LabelPainter.EXTERNAL_WIDTH, labelWidth) * scale);
    const widest = Math.ceil(Math.max(...first.map((text) => TextMetrics.width(text) / scale)) - 1e-9);
    const lines = TextMetrics.wrap(value, widest * scale + 1e-6);
    const width = Math.max(...lines.map((text) => TextMetrics.width(text) / scale), 1);
    return {
      box: new Box(centerX - width / 2, top, width, lines.length * line),
      svg: Svg.lines(lines, centerX, top + line * LabelPainter.FIRST_BASELINE, LabelPainter.EXTERNAL_SIZE, this.color, 'middle', ` data-label="${Svg.attribute(id)}"`),
    };
  }

  message(id: string, value: string, anchor: Point): PaintedLabel {
    const line = Svg.FONT_SIZE * LabelPainter.LINE_FACTOR;
    const lines = TextMetrics.wrap(value, LabelPainter.MESSAGE_WIDTH);
    const width = Math.max(...lines.map((text) => TextMetrics.width(text)), 1);
    const top = anchor.y + 10;
    return {
      box: new Box(anchor.x, top, width, lines.length * line),
      svg: Svg.lines(lines, anchor.x + width / 2, top + line * LabelPainter.FIRST_BASELINE, Svg.FONT_SIZE, this.color, 'middle', ` data-message="${Svg.attribute(id)}"`),
    };
  }

  inBox(value: string, box: Box, placement: LabelPlacement): string {
    const { horizontal, vertical, padding, transform = '' } = placement;
    const lines = TextMetrics.wrap(value, box.width - 2 * padding);
    const line = Svg.FONT_SIZE * LabelPainter.LINE_FACTOR;
    const top = vertical === 'middle' ? (box.height - lines.length * line) / 2 : padding;
    const left = horizontal === 'left' ? box.x + padding : box.centerX;
    return Svg.lines(lines, left, box.y + top + line * LabelPainter.FIRST_BASELINE, Svg.FONT_SIZE, this.color, horizontal === 'left' ? 'start' : 'middle', transform);
  }
}

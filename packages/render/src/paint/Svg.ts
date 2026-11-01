import type { Box } from '../read/index.js';

export class Svg {
  static readonly STROKE = '#22242a';
  static readonly FILL = '#ffffff';
  static readonly FONT_SIZE = 12;

  static number(coordinate: number): string {
    const rounded = Math.round(coordinate * 100) / 100;
    return String(rounded === 0 ? 0 : rounded);
  }

  static attribute(source: string): string {
    return Svg.text(source).replace(/"/g, '&quot;');
  }

  static box(box: Box): string {
    return `x="${Svg.number(box.x)}" y="${Svg.number(box.y)}" width="${Svg.number(box.width)}" height="${Svg.number(box.height)}"`;
  }

  static at(left: number, top: number, scale: number, body: string): string {
    return `<g transform="translate(${Svg.number(left)} ${Svg.number(top)})${scale !== 1 ? ` scale(${Svg.number(scale)})` : ''}">${body}</g>`;
  }

  static lines(textLines: string[], left: number, baseline: number, size: number, color: string, anchor: 'middle' | 'start', extra = ''): string {
    const step = size * 1.2;
    const spans = textLines.map((line, index) => `<tspan x="${Svg.number(left)}" y="${Svg.number(baseline + index * step)}">${Svg.text(line.trim())}</tspan>`).join('');
    return `<text${extra} font-size="${size}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
  }

  private static text(source: string): string {
    return source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

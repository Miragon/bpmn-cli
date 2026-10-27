export const STROKE = '#22242a';
export const FILL = '#ffffff';
export const SIZE = 12;

/** Deterministic text: 2 decimals, no -0. */
export function formatNumber(coordinate: number): string {
  const rounded = Math.round(coordinate * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

function text(source: string): string {
  return source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function attr(source: string): string {
  return text(source).replace(/"/g, '&quot;');
}

export function at(left: number, top: number, scale: number, body: string): string {
  return `<g transform="translate(${formatNumber(left)} ${formatNumber(top)})${scale !== 1 ? ` scale(${formatNumber(scale)})` : ''}">${body}</g>`;
}

/** Lines as one <text>: `x` and the first baseline `y`, each next line `size * 1.2` lower. */
export function lines(textLines: string[], left: number, baseline: number, size: number, color: string, anchor: 'middle' | 'start', extra = ''): string {
  const step = size * 1.2;
  const spans = textLines.map((line, index) => `<tspan x="${formatNumber(left)}" y="${formatNumber(baseline + index * step)}">${text(line.trim())}</tspan>`).join('');
  return `<text${extra} font-size="${size}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
}

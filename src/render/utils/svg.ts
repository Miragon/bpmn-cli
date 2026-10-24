export const STROKE = '#22242a';
export const FILL = '#ffffff';
export const SIZE = 12;

/** A coordinate rounded to 2 decimals (deterministic text, no -0). */
export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r);
}

export function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function attr(s: string): string {
  return text(s).replace(/"/g, '&quot;');
}

/** A glyph in its own coordinates (centred on 0,0 for events and gateways), placed and scaled. */
export function at(x: number, y: number, k: number, body: string): string {
  return `<g transform="translate(${n(x)} ${n(y)})${k !== 1 ? ` scale(${n(k)})` : ''}">${body}</g>`;
}

/** Lines as one <text>: `x` and the first baseline `y`, each next line `size * 1.2` lower. */
export function lines(ls: string[], x: number, y: number, size: number, color: string, anchor: 'middle' | 'start', extra = ''): string {
  const step = size * 1.2;
  const spans = ls.map((l, i) => `<tspan x="${n(x)}" y="${n(y + i * step)}">${text(l.trim())}</tspan>`).join('');
  return `<text${extra} font-size="${size}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
}

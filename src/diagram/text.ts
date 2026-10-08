/**
 * The text inside an activity as bpmn-js draws it, to size a shape for its
 * name.
 *
 * CONTRACT
 *  - textWidth(text) estimates the rendered width of one line in 12px Arial
 *    (Arial's advance widths; characters not in the table count as an average
 *    letter). Leading / trailing blanks do not count (SVG drops them).
 *  - innerLines(name, width) is the number of lines bpmn-js needs for `name`
 *    inside a shape `width` px wide: the line breaking of diagram-js Text
 *    (inner padding 7, so lines up to width - 14 px; a too long line is
 *    shortened in proportion to its overflow at blanks and hyphens, a word
 *    longer than the line is cut), explicit line breaks kept.
 *  - fitsInside(name, size, bottomRoom?) says whether those lines (14.4 px
 *    each, centred vertically) fit into the height while keeping
 *    max(4, bottomRoom) px free at the bottom, and so (centred) as much at the
 *    top: 5 lines in an 80 px task; with BOTTOM_ROOM for a marker or
 *    boundary events on the bottom border 3 lines (4 in 100 px).
 *  - activitySize(name, size, bottomRoom?) is the size an activity needs for its
 *    name: undefined when the current size fits; else wider in steps of 20
 *    (up to 200 px, never narrower than now), and when even that does not
 *    fit, higher in steps of 20 (at most 5 steps) at the narrowest of those
 *    widths that breaks the name into as few lines as 200 px do. Never
 *    smaller than `size`.
 */

/** advance widths of Arial in 1/1000 em */
const ARIAL: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584,
  ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  ä: 556, ö: 556, ü: 556, Ä: 667, Ö: 778, Ü: 722, ß: 611, é: 556, è: 556, ê: 556, à: 556, á: 556, â: 556, ç: 500,
  ñ: 556, ó: 556, ò: 556, ô: 556, ú: 556, ù: 556, í: 278, ì: 278, î: 278, '€': 556, '–': 556, '—': 1000, '…': 1000,
  '„': 333, '“': 333, '”': 333, '‘': 222, '’': 222, '§': 556, '°': 400,
};
const DEFAULT_ADVANCE = 556;
const FONT_SIZE = 12;
/** bpmn-js: line height 1.2 em */
export const LINE_HEIGHT = 14.4;
/** bpmn-js: padding of the embedded label of an activity */
const PADDING = 7;
const SOFT_BREAK = '­';

export function textWidth(text: string): number {
  let units = 0;
  for (const ch of text.trim()) units += ARIAL[ch] ?? DEFAULT_ADVANCE;
  return (units * FONT_SIZE) / 1000;
}

/** diagram-js semanticShorten: the leading parts (split at blanks / hyphens) shorter than `max` characters. */
function semanticShorten(line: string, max: number): string {
  const parts = line.split(/(\s|-|­)/g);
  const out: string[] = [];
  let length = 0;
  if (parts.length > 1) {
    let part: string | undefined;
    while ((part = parts.shift())) {
      if (part.length + length < max) {
        out.push(part);
        length += part.length;
      } else {
        if (part === '-' || part === SOFT_BREAK) out.pop();
        break;
      }
    }
  }
  if (out[out.length - 1] === SOFT_BREAK) out[out.length - 1] = '-';
  return out.join('');
}

/** diagram-js shortenLine */
function shortenLine(line: string, width: number, maxWidth: number): string {
  const length = Math.max(line.length * (maxWidth / width), 1);
  return semanticShorten(line, length) || line.slice(0, Math.max(Math.round(length - 1), 1));
}

/** Number of lines bpmn-js breaks `name` into inside a shape `width` px wide. */
export function innerLines(name: string, width: number): number {
  const maxWidth = width - 2 * PADDING;
  const lines = name.split(/­?\r?\n/);
  let count = 0;
  for (let guard = 0; lines.length && guard < 500; guard++) {
    const original = lines.shift()!;
    let fit = original;
    for (let k = 0; k < 200; k++) {
      const w = fit ? textWidth(fit) : 0;
      if (fit === ' ' || fit === '' || w <= maxWidth || fit.length < 2) break;
      fit = shortenLine(fit, w, maxWidth);
    }
    if (fit.length < original.length) lines.unshift(original.slice(fit.length).trim());
    count++;
  }
  return count;
}

/** room a marker or a boundary event on the bottom border needs below the text (glyphs end ~3 px above their line box) */
export const BOTTOM_ROOM = 17;

export function fitsInside(name: string, size: { width: number; height: number }, bottomRoom = 0): boolean {
  return innerLines(name, size.width) * LINE_HEIGHT <= size.height - 2 * Math.max(4, bottomRoom) + 0.01;
}

const STEP = 20;
const MAX_WIDTH = 200;
const MAX_HEIGHT_STEPS = 5;

export function activitySize(name: string, size: { width: number; height: number }, bottomRoom = 0): { width: number; height: number } | undefined {
  if (!name.trim() || fitsInside(name, size, bottomRoom)) return undefined;
  const widths: number[] = [];
  for (let w = size.width + STEP; w <= Math.max(MAX_WIDTH, size.width); w += STEP) {
    if (fitsInside(name, { width: w, height: size.height }, bottomRoom)) return { width: w, height: size.height };
    widths.push(w);
  }
  // higher it must be: as narrow as the widest step allows (no wider than that line count needs)
  const fewest = innerLines(name, widths[widths.length - 1] ?? size.width);
  const width = [size.width, ...widths].find((w) => innerLines(name, w) <= fewest) ?? size.width;
  let height = size.height;
  for (let k = 1; k <= MAX_HEIGHT_STEPS; k++) {
    height = size.height + k * STEP;
    if (fitsInside(name, { width, height }, bottomRoom)) break;
  }
  return { width, height };
}

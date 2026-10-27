/**
 * Text metrics as bpmn-js renders them (12px Arial, diagram-js line breaking), to size shapes
 * and find sub-process titles. The renderer, both engines and the metrics share them.
 */
import type { Box } from '../di/types.js';

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
/** bpmn-js: line height 1.2 em */
export const LINE_HEIGHT = 14.4;
const SOFT_BREAK = '­';

/** Width at 12 px; the advances are in 1/1000 em. */
export function textWidth(text: string): number {
  let units = 0;
  for (const ch of text.trim()) units += ARIAL[ch] ?? DEFAULT_ADVANCE;
  return (units * 12) / 1000;
}

/** diagram-js semanticShorten. */
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
  if (out.at(-1) === SOFT_BREAK) out[out.length - 1] = '-';
  return out.join('');
}

/** diagram-js shortenLine */
function shortenLine(line: string, width: number, maxWidth: number): string {
  const length = Math.max(line.length * (maxWidth / width), 1);
  return semanticShorten(line, length) || line.slice(0, Math.max(Math.round(length - 1), 1));
}

/** diagram-js line breaking in 12px Arial; for an 11 px font pass maxWidth * 12 / 11. */
export function wrapLines(text: string, maxWidth: number): string[] {
  const lines = text.split(/­?\r?\n/);
  const out: string[] = [];
  while (lines.length && out.length < 500) {
    const original = lines.shift()!;
    let fit = original;
    for (let attempt = 0; attempt < 200; attempt++) {
      const width = textWidth(fit);
      if (fit === ' ' || fit === '' || width <= maxWidth || fit.length < 2) break;
      fit = shortenLine(fit, width, maxWidth);
    }
    if (fit.length < original.length) lines.unshift(original.slice(fit.length).trim());
    out.push(fit);
  }
  return out;
}

const PADDING = 7;

export const innerLines = (name: string, width: number): number => wrapLines(name, width - 2 * PADDING).length;

/** Where bpmn-js draws an expanded sub-process's name: centred, starting 7 px below the top. */
export function titleBox(bounds: Box, name: string | undefined): Box | undefined {
  if (!name || !name.trim()) return undefined;
  const lines = wrapLines(name, bounds.width - 2 * PADDING);
  const width = Math.max(...lines.map((line) => textWidth(line)));
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + PADDING, width, height: lines.length * LINE_HEIGHT };
}

export function titleDepth(name: string | undefined, width: number): number {
  return name && name.trim() ? PADDING + innerLines(name, width) * LINE_HEIGHT : 0;
}

/**
 * room a marker or a bottom-border boundary event needs below the text
 * (glyphs end ~3 px above their line box)
 */
export const BOTTOM_ROOM = 17;

export function fitsInside(name: string, size: { width: number; height: number }, bottomRoom = 0): boolean {
  return innerLines(name, size.width) * LINE_HEIGHT <= size.height - 2 * Math.max(4, bottomRoom) + 0.01;
}

const STEP = 20;
const MAX_WIDTH = 200;
const MAX_HEIGHT_STEPS = 5;

/**
 * Undefined when the name fits; else wider in 20 px steps up to 200, then higher.
 * Higher at the narrowest width that still gives the line count of the widest step.
 */
export function activitySize(name: string, size: { width: number; height: number }, bottomRoom = 0): { width: number; height: number } | undefined {
  if (!name.trim() || fitsInside(name, size, bottomRoom)) return undefined;
  const widths: number[] = [];
  for (let candidateWidth = size.width + STEP; candidateWidth <= Math.max(MAX_WIDTH, size.width); candidateWidth += STEP) {
    if (fitsInside(name, { width: candidateWidth, height: size.height }, bottomRoom)) return { width: candidateWidth, height: size.height };
    widths.push(candidateWidth);
  }
  const fewest = innerLines(name, widths.at(-1) ?? size.width);
  const width = [size.width, ...widths].find((width) => innerLines(name, width) <= fewest) ?? size.width;
  let height = size.height;
  for (let step = 1; step <= MAX_HEIGHT_STEPS; step++) {
    height = size.height + step * STEP;
    if (fitsInside(name, { width, height }, bottomRoom)) break;
  }
  return { width, height };
}

/** the layout asks for the same names over and over; cleared when full */
const sizes = new Map<number, Map<string, { width: number; height: number; lines: number }>>();

/** Estimated bpmn-js label box; do not change the result. */
export function labelSize(name: string, maxWidth = 90): { width: number; height: number; lines: number } {
  let byName = sizes.get(maxWidth);
  if (!byName) sizes.set(maxWidth, (byName = new Map()));
  let size = byName.get(name);
  if (!size) {
    if (byName.size >= 4096) byName.clear();
    byName.set(name, (size = measureLabel(name, maxWidth)));
  }
  return size;
}

/** Wraps the words into lines of at most maxWidth, widened to the longest word: a word is never broken. */
function measureLabel(name: string, maxWidth: number): { width: number; height: number; lines: number } {
  const words = name.split(/\s+/).filter(Boolean);
  const charW = 7;
  const pad = 12;
  const longest = Math.max(0, ...words.map((word) => word.length * charW + pad));
  const limit = Math.max(maxWidth, longest);
  const lines: number[] = [];
  let cur = 0;
  for (const word of words) {
    const ww = word.length * charW;
    if (cur === 0) cur = ww;
    else if (cur + charW + ww + pad <= limit) cur += charW + ww;
    else {
      lines.push(cur);
      cur = ww;
    }
  }
  if (cur > 0 || !lines.length) lines.push(cur);
  const width = Math.max(20, Math.min(limit, Math.max(...lines) + pad));
  return { width, height: lines.length * LABEL_LINE, lines: lines.length };
}

export const LABEL_LINE = 14;

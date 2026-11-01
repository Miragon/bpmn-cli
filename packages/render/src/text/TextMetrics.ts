export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextSize {
  width: number;
  height: number;
}

export interface LabelSize extends TextSize {
  lines: number;
}

export class TextMetrics {
  static readonly BOTTOM_ROOM = 17;
  static readonly LABEL_LINE = 14;

  private static readonly ARIAL: Readonly<Record<string, number>> = {
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
  private static readonly DEFAULT_ADVANCE = 556;
  private static readonly FONT_SIZE = 12;
  private static readonly LINE_HEIGHT = 14.4;
  private static readonly PADDING = 7;
  private static readonly SOFT_BREAK = '\u00AD';
  private static readonly SIZE_STEP = 20;
  private static readonly MAX_ACTIVITY_WIDTH = 200;
  private static readonly MAX_HEIGHT_STEPS = 5;
  private static readonly MAX_REMEMBERED_NAMES = 4096;
  private static readonly MAX_LINES = 500;
  private static readonly MAX_SHORTENINGS = 200;
  private static readonly LABEL_CHAR_WIDTH = 7;
  private static readonly LABEL_PADDING = 12;
  private static readonly MIN_LABEL_WIDTH = 20;
  private static readonly labelSizes = new Map<number, Map<string, LabelSize>>();

  static width(text: string): number {
    let units = 0;
    for (const character of text.trim()) {
      units += TextMetrics.ARIAL[character] ?? TextMetrics.DEFAULT_ADVANCE;
    }
    return (units * TextMetrics.FONT_SIZE) / 1000;
  }

  static wrap(text: string, maxWidth: number): string[] {
    const lines = text.split(/\u00AD?\r?\n/);
    const wrapped: string[] = [];
    while (lines.length && wrapped.length < TextMetrics.MAX_LINES) {
      const original = lines.shift() as string;
      const fit = TextMetrics.fittingStart(original, maxWidth);
      if (fit.length < original.length) {
        lines.unshift(original.slice(fit.length).trim());
      }
      wrapped.push(fit);
    }
    return wrapped;
  }

  static titleBox(bounds: TextBox, name: string | undefined): TextBox | undefined {
    if (!name || !name.trim()) {
      return undefined;
    }
    const lines = TextMetrics.wrap(name, bounds.width - 2 * TextMetrics.PADDING);
    const width = Math.max(...lines.map((line) => TextMetrics.width(line)));
    return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + TextMetrics.PADDING, width, height: lines.length * TextMetrics.LINE_HEIGHT };
  }

  static titleDepth(name: string | undefined, width: number): number {
    return name && name.trim() ? TextMetrics.PADDING + TextMetrics.innerLines(name, width) * TextMetrics.LINE_HEIGHT : 0;
  }

  static activitySize(name: string, size: TextSize, bottomRoom = 0): TextSize | undefined {
    if (!name.trim() || TextMetrics.fitsInside(name, size, bottomRoom)) {
      return undefined;
    }
    const widths: number[] = [];
    const widest = Math.max(TextMetrics.MAX_ACTIVITY_WIDTH, size.width);
    for (let width = size.width + TextMetrics.SIZE_STEP; width <= widest; width += TextMetrics.SIZE_STEP) {
      if (TextMetrics.fitsInside(name, { width, height: size.height }, bottomRoom)) {
        return { width, height: size.height };
      }
      widths.push(width);
    }
    const fewest = TextMetrics.innerLines(name, widths.at(-1) ?? size.width);
    const width = [size.width, ...widths].find((candidate) => TextMetrics.innerLines(name, candidate) <= fewest) ?? size.width;
    return { width, height: TextMetrics.heightFor(name, width, size.height, bottomRoom) };
  }

  static labelSize(name: string, maxWidth = 90): LabelSize {
    const byName = TextMetrics.labelSizes.get(maxWidth) ?? new Map<string, LabelSize>();
    TextMetrics.labelSizes.set(maxWidth, byName);
    const known = byName.get(name);
    if (known) {
      return known;
    }
    if (byName.size >= TextMetrics.MAX_REMEMBERED_NAMES) {
      byName.clear();
    }
    const size = TextMetrics.measuredLabel(name, maxWidth);
    byName.set(name, size);
    return size;
  }

  private static fittingStart(original: string, maxWidth: number): string {
    let fit = original;
    for (let attempt = 0; attempt < TextMetrics.MAX_SHORTENINGS; attempt++) {
      const width = TextMetrics.width(fit);
      if (fit === ' ' || fit === '' || width <= maxWidth || fit.length < 2) {
        break;
      }
      fit = TextMetrics.shortened(fit, width, maxWidth);
    }
    return fit;
  }

  private static shortened(line: string, width: number, maxWidth: number): string {
    const length = Math.max(line.length * (maxWidth / width), 1);
    return TextMetrics.shortenedAtBreak(line, length) || line.slice(0, Math.max(Math.round(length - 1), 1));
  }

  private static shortenedAtBreak(line: string, maxLength: number): string {
    const parts = line.split(/(\s|-|\u00AD)/g);
    const kept: string[] = [];
    let length = 0;
    if (parts.length > 1) {
      for (let part = parts.shift(); part; part = parts.shift()) {
        if (part.length + length >= maxLength) {
          if (part === '-' || part === TextMetrics.SOFT_BREAK) {
            kept.pop();
          }
          break;
        }
        kept.push(part);
        length += part.length;
      }
    }
    if (kept.at(-1) === TextMetrics.SOFT_BREAK) {
      kept[kept.length - 1] = '-';
    }
    return kept.join('');
  }

  private static innerLines(name: string, width: number): number {
    return TextMetrics.wrap(name, width - 2 * TextMetrics.PADDING).length;
  }

  private static fitsInside(name: string, size: TextSize, bottomRoom: number): boolean {
    return TextMetrics.innerLines(name, size.width) * TextMetrics.LINE_HEIGHT <= size.height - 2 * Math.max(4, bottomRoom) + 0.01;
  }

  private static heightFor(name: string, width: number, startHeight: number, bottomRoom: number): number {
    let height = startHeight;
    for (let step = 1; step <= TextMetrics.MAX_HEIGHT_STEPS; step++) {
      height = startHeight + step * TextMetrics.SIZE_STEP;
      if (TextMetrics.fitsInside(name, { width, height }, bottomRoom)) {
        break;
      }
    }
    return height;
  }

  private static measuredLabel(name: string, maxWidth: number): LabelSize {
    const { LABEL_CHAR_WIDTH: charWidth, LABEL_PADDING: padding } = TextMetrics;
    const words = name.split(/\s+/).filter(Boolean);
    const longest = Math.max(0, ...words.map((word) => word.length * charWidth + padding));
    const limit = Math.max(maxWidth, longest);
    const lines = TextMetrics.labelLines(words, limit);
    const width = Math.max(TextMetrics.MIN_LABEL_WIDTH, Math.min(limit, Math.max(...lines) + padding));
    return { width, height: lines.length * TextMetrics.LABEL_LINE, lines: lines.length };
  }

  private static labelLines(words: string[], limit: number): number[] {
    const { LABEL_CHAR_WIDTH: charWidth, LABEL_PADDING: padding } = TextMetrics;
    const lines: number[] = [];
    let current = 0;
    for (const word of words) {
      const wordWidth = word.length * charWidth;
      if (current === 0) {
        current = wordWidth;
      } else if (current + charWidth + wordWidth + padding <= limit) {
        current += charWidth + wordWidth;
      } else {
        lines.push(current);
        current = wordWidth;
      }
    }
    if (current > 0 || !lines.length) {
      lines.push(current);
    }
    return lines;
  }
}

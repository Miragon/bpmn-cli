export class IdCut {
  static readonly MAX_ID = 64;
  private static readonly FILLERS = new Set(['und', 'oder', 'an', 'am', 'auf', 'aus', 'bei', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'fuer', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'im', 'in', 'and', 'or', 'of', 'to', 'the', 'a', 'for', 'with', 'on', 'at', 'by']);
  private static readonly SUFFIX_WORD = 'No';
  private static readonly KEPT_TAIL = /(?:(?<=[a-z0-9])Join|[_-][Jj]oin)?(?:(?<=[A-Za-z])\d+|[_-]\d+)?$/;

  static isFiller(word: string): boolean {
    return IdCut.FILLERS.has(word.replace(/^[_.-]+/, '').toLowerCase());
  }

  static cutAt(slug: string, max: number, names = false): string {
    if (slug.length <= max) {
      return slug;
    }
    const tail = IdCut.keptTail(slug);
    if (tail && max - tail.length >= 8) {
      const head = slug.slice(0, -tail.length);
      const cut = IdCut.cutWords(head, max - tail.length, names);
      if (IdCut.readsApart(cut, tail)) {
        return `${cut}${tail}`;
      }
      const kept = names ? IdCut.cutWords(head, max - tail.length) : cut;
      if (IdCut.readsApart(kept, tail)) {
        return `${kept}${tail}`;
      }
      const inside = IdCut.trimSeparators(head.slice(0, max - tail.length));
      if (IdCut.readsApart(inside, tail)) {
        return `${inside}${tail}`;
      }
    }
    return IdCut.cutWords(slug, max, names);
  }

  static cutName(slug: string, max: number): string {
    return IdCut.cutAt(slug, max, true);
  }

  static readsApart(head: string, tail: string): boolean {
    return /[A-Za-z]/.test(head) && !(/\d$/.test(head) && /^\d/.test(tail));
  }

  static withLetter(slug: string, cut: string, again: (rest: string) => string): string {
    if (/[A-Za-z]/.test(cut)) {
      return cut;
    }
    const words = IdCut.idWords(slug);
    const at = words.findIndex((word) => /[A-Za-z]/.test(word));
    return at > 0 ? again(words.slice(at).join('').replace(/^[_.-]+/, '')) : cut;
  }

  static idWords(slug: string): string[] {
    const out: string[] = [];
    let start = 0;
    for (let index = 1; index < slug.length; index++) {
      const prev = slug.charAt(index - 1);
      const character = slug.charAt(index);
      if (/[_.-]/.test(prev)) {
        continue;
      }
      const boundary = /[_.-]/.test(character) || (/[A-Z]/.test(character) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(character) && /[A-Za-z]/.test(prev));
      if (boundary) {
        out.push(slug.slice(start, index));
        start = index;
      }
    }
    if (slug) {
      out.push(slug.slice(start));
    }
    return out;
  }

  static keptTail(slug: string): string {
    const tail = IdCut.KEPT_TAIL.exec(slug)?.[0] ?? '';
    return tail.length < slug.length ? tail : '';
  }

  static withSuffix(base: string, sep: string, suffixNumber: number, cut: (max: number) => string = (max) => IdCut.cutAt(base, max)): string {
    const fit = (suffix: string): string => (base.length + suffix.length <= IdCut.MAX_ID ? base : cut(IdCut.MAX_ID - suffix.length));
    if (sep !== '') {
      return `${fit(`${sep}${suffixNumber}`)}${sep}${suffixNumber}`;
    }
    const glued = fit(`${suffixNumber}`);
    if (!/\d$/.test(glued)) {
      return `${glued}${suffixNumber}`;
    }
    const worded = fit(`${IdCut.SUFFIX_WORD}${suffixNumber}`);
    return /\d$/.test(worded) ? `${worded}${IdCut.SUFFIX_WORD}${suffixNumber}` : `${worded}${suffixNumber}`;
  }

  static isSuffix(base: string, rest: string, sep: string | 'either'): boolean {
    const word = /\d$/.test(base) ? `(?:${IdCut.SUFFIX_WORD})?` : '';
    if (sep === 'either') {
      return new RegExp(`^(?:[_-]|${word})\\d+$`).test(rest);
    }
    return new RegExp(sep === '' ? `^${word}\\d+$` : `^${sep}\\d+$`).test(rest);
  }

  private static trimSeparators(slug: string): string {
    return slug.replace(/[_.-]+$/, '');
  }

  private static cutWords(slug: string, max: number, names = false): string {
    if (slug.length <= max) {
      return slug;
    }
    const words: string[] = [];
    let length = 0;
    for (const word of IdCut.idWords(slug)) {
      if (length + word.length > max) {
        break;
      }
      words.push(word);
      length += word.length;
    }
    if (names) {
      while (words.length > 1 && IdCut.isFiller(words[words.length - 1]!) && words.slice(0, -1).some((word) => /[A-Za-z]/.test(word))) {
        words.pop();
      }
    }
    const out = words.join('');
    if (out && /[A-Za-z]/.test(out)) {
      return IdCut.trimSeparators(out);
    }
    return IdCut.trimSeparators(IdCut.withLetter(slug, slug.slice(0, Math.max(max, 0)), (rest) => IdCut.cutWords(rest, max, names)));
  }
}

import { camelSlug, idWords, isFiller, kebabSlug, keptTail, slugify, snakeSlug, readsApart, withLetter } from '../utils/slug.js';
import { beginAlike } from '../utils/id-words.js';
import type { Body } from './IdStyle.js';

interface EndForm {
  text: string;
  words: number;
}

/**
 * Fits flow ids into 64 characters: the two ends share the room and give up words,
 * so the id still tells both ends apart.
 */
export class IdFitter {
  private readonly body: Body;
  /** the numbers the closing end does not end on, as they would look like a collision suffix */
  private readonly closes: RegExp;
  private readonly names: string[] | undefined;

  constructor(opts: { body?: Body; suffixSep?: string; names?: string[] } = {}) {
    this.body = opts.body ?? 'pascal';
    const suffixSep = opts.suffixSep ?? '_';
    this.closes = suffixSep === '' ? /^[_.-]*\d+$/ : new RegExp(`^${suffixSep}\\d+$`);
    this.names = opts.names;
  }

  ends(source: string, target: string): [string, string, string] {
    switch (this.body) {
      case 'camel':
        return [camelSlug(source), 'To', slugify(target)];
      case 'snake':
        return [snakeSlug(source), '_to_', snakeSlug(target)];
      case 'kebab':
        return [kebabSlug(source), '-to-', kebabSlug(target)];
      default:
        return [slugify(source), 'To', slugify(target)];
    }
  }

  pair(head: string, sourceEnd: string, join: string, targetEnd: string, max: number): string {
    const room = max - head.length - join.length;
    const [fittedSource, fittedTarget] = this.fitPair(sourceEnd, targetEnd, Math.max(room, 0));
    return `${head}${fittedSource}${join}${fittedTarget}`;
  }

  /**
   * Each end gives up words one by one, never its first or its last word with a letter, never a
   * word between two numbers (`Stufe23`); of the pairs that fit, most words, then most
   * characters, then the more even wins. Only when nothing fits is a word cut inside, and the
   * other end takes back what fits beside the cut.
   */
  private fitPair(sourceEnd: string, targetEnd: string, room: number): [string, string] {
    if (sourceEnd.length + targetEnd.length <= room) return [sourceEnd, targetEnd];
    const { best, fa, fb } = this.bestPair(sourceEnd, targetEnd, room);
    if (best) return best;
    const [shortestSource, shortestTarget] = [fa[fa.length - 1]!.text, fb[fb.length - 1]!.text];
    const long = shortestSource.length >= shortestTarget.length ? 0 : 1;
    const keep = room - (long ? shortestSource : shortestTarget).length;
    if (keep < 8) {
      return this.sharePair(shortestSource, shortestTarget, room, (slug, max) => this.cutInside(slug, max));
    }
    const cut = this.cutInside(long ? shortestTarget : shortestSource, keep);
    const other = (long ? fa : fb).find((form) => form.text.length + cut.length <= room)!.text;
    return long ? [other, cut] : [cut, other];
  }

  /** The pair of end forms that scores best; later pairs win a full tie, as the source has given up more. */
  private bestPair(sourceEnd: string, targetEnd: string, room: number): { best?: [string, string]; fa: EndForm[]; fb: EndForm[] } {
    const keepLast = beginAlike(sourceEnd, targetEnd);
    const [fa, fb] = [this.endForms(sourceEnd, keepLast, room, this.names), this.endForms(targetEnd, keepLast, room, undefined, this.closes)];
    const score = (sourceForm: EndForm, targetForm: EndForm): number[] => [sourceForm.words + targetForm.words, sourceForm.text.length + targetForm.text.length, -Math.abs(sourceForm.text.length - targetForm.text.length)];
    let best: { x: EndForm; y: EndForm; score: number[] } | undefined;
    for (const sourceForm of fa) {
      for (const targetForm of fb) {
        if (sourceForm.text.length + targetForm.text.length > room) continue;
        const candidateScore = score(sourceForm, targetForm);
        const firstDifference = best ? candidateScore.findIndex((component, index) => component !== best!.score[index]) : 0;
        if (!best || firstDifference === -1 || candidateScore[firstDifference]! > best.score[firstDifference]!) {
          best = { x: sourceForm, y: targetForm, score: candidateScore };
        }
      }
    }
    return { ...(best ? { best: [best.x.text, best.y.text] as [string, string] } : {}), fa, fb };
  }

  /**
   * An end after each word it gives up, shortest last; of the forms over `room` only the last.
   * A number followed only by numbers is kept (zahlungseingang_2_2 never shrinks to zahlungseingang_2,
   * another element's id); a trailing number that reads like a collision suffix goes too, as does a filler word.
   */
  private endForms(end: string, keepLast: boolean, room: number, names?: string[], closes?: RegExp): EndForm[] {
    const words = idWords(end);
    const tail = idWords(keptTail(end)).length;
    const kept = keepLast ? Math.max(tail, 1) : tail;
    const letter = (word: string): boolean => /[A-Za-z]/.test(word);
    const number = (word: string): boolean => /^[_.-]*\d+$/.test(word);
    const filler = (): number => {
      const index = words.length - tail - 1;
      if (index < 1 || index > words.length - 1 - kept || !isFiller(words[index]!)) {
        return -1;
      }
      if (!words.some((other, otherIndex) => otherIndex !== index && otherIndex < words.length - tail && letter(other))) {
        return -1;
      }
      return /\d$/.test(words[index - 1]!) && /^[_.-]*\d/.test(words[index + 1] ?? '') ? -1 : index;
    };
    const victim = (): number => {
      const head = words.length - tail;
      for (let index = words.length - 1 - kept; index >= (keepLast ? 0 : 1); index--) {
        if (letter(words[index]!) && !words.some((other, otherIndex) => otherIndex !== index && otherIndex < head && letter(other))) {
          continue;
        }
        if (number(words[index]!) && index + 1 < words.length && words.slice(index + 1).every(number)) {
          continue;
        }
        if (index === 0 ? /^[_.-]*[A-Za-z]/.test(words[1] ?? '') : !(/\d$/.test(words[index - 1]!) && /^[_.-]*\d/.test(words[index + 1] ?? ''))) {
          return index;
        }
      }
      return -1;
    };
    const out: EndForm[] = end.length <= room ? [{ text: end, words: words.length }] : [];
    let length = end.length;
    for (let index = victim(); index >= 0; index = victim()) {
      const [dropped] = words.splice(index, 1);
      length -= dropped!.length;
      if (index === 0) {
        const next = words[0]!.replace(/^[_.-]+/, '');
        length -= words[0]!.length - next.length;
        words[0] = /^[a-z]/.test(dropped!) ? this.lowerFirst(next, words.slice(1).join(''), names) : next;
      }
      for (let more = true; more; ) {
        more = false;
        while (closes && !kept && words.length > 1 && closes.test(words[words.length - 1]!)) {
          length -= words.pop()!.length;
          more = true;
        }
        const fillerIndex = filler();
        if (fillerIndex >= 0) {
          length -= words.splice(fillerIndex, 1)[0]!.length;
          more = true;
        }
      }
      if (length <= room) out.push({ text: words.join(''), words: words.length });
    }
    if (length > room) out.push({ text: words.join(''), words: words.length });
    return out;
  }

  /**
   * Lower-cases as camelSlug writes a first word; `names` tell where a run of capitals ends
   * (URL PDF versenden -> urlPDFVersenden, without them urlpdfVersenden).
   */
  private lowerFirst(word: string, rest: string, names?: string[]): string {
    const end = `${word}${rest}`.toLowerCase();
    const tails = (names ?? []).map((_name, start) => camelSlug(names!.slice(start).join(' '))).reverse();
    const own = tails.find((tail) => tail.toLowerCase() === end) ?? tails.find((tail) => tail.toLowerCase().startsWith(end));
    if (own) return own.slice(0, word.length);
    return word.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (capitals) => capitals.toLowerCase());
  }

  /** Keeps the join or number tail (`3Zahlungseingangsbest2024`) where the two read apart. */
  private cutInside(slug: string, max: number): string {
    if (slug.length <= max) return slug;
    const tail = keptTail(slug);
    const head = slug.slice(0, Math.max(max - tail.length, 0)).replace(/[_.-]+$/, '');
    if (tail && readsApart(head, tail)) return `${head}${tail}`;
    return withLetter(slug, slug.slice(0, Math.max(max, 0)).replace(/[_.-]+$/, ''), (rest) => this.cutInside(rest, max));
  }

  /** The first end gets at least half, the second the rest, the first what the second leaves. */
  private sharePair(sourceEnd: string, targetEnd: string, room: number, cut: (slug: string, max: number) => string): [string, string] {
    const first = cut(sourceEnd, Math.max(Math.floor(room / 2), room - targetEnd.length));
    const second = cut(targetEnd, room - first.length);
    return [cut(sourceEnd, room - second.length), second];
  }
}

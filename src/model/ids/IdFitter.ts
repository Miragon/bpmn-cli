import { IdCut } from './IdCut.js';
import type { Body } from './IdDefaults.js';
import { IdSlug } from './IdSlug.js';
import { IdWords } from './IdWords.js';

interface EndForm {
  text: string;
  words: number;
}

interface WordShape {
  tail: number;
  kept: number;
  keepLast: boolean;
}

export class IdFitter {
  private readonly body: Body;
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
        return [IdSlug.camelSlug(source), 'To', IdSlug.slugify(target)];
      case 'snake':
        return [IdSlug.snakeSlug(source), '_to_', IdSlug.snakeSlug(target)];
      case 'kebab':
        return [IdSlug.kebabSlug(source), '-to-', IdSlug.kebabSlug(target)];
      default:
        return [IdSlug.slugify(source), 'To', IdSlug.slugify(target)];
    }
  }

  pair(head: string, sourceEnd: string, join: string, targetEnd: string, max: number): string {
    const room = max - head.length - join.length;
    const [fittedSource, fittedTarget] = this.fitPair(sourceEnd, targetEnd, Math.max(room, 0));
    return `${head}${fittedSource}${join}${fittedTarget}`;
  }

  private fitPair(sourceEnd: string, targetEnd: string, room: number): [string, string] {
    if (sourceEnd.length + targetEnd.length <= room) {
      return [sourceEnd, targetEnd];
    }
    const { best, fa, fb } = this.bestPair(sourceEnd, targetEnd, room);
    if (best) {
      return best;
    }
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

  private bestPair(sourceEnd: string, targetEnd: string, room: number): { best?: [string, string]; fa: EndForm[]; fb: EndForm[] } {
    const keepLast = IdWords.beginAlike(sourceEnd, targetEnd);
    const [fa, fb] = [this.endForms(sourceEnd, keepLast, room, this.names), this.endForms(targetEnd, keepLast, room, undefined, this.closes)];
    const score = (sourceForm: EndForm, targetForm: EndForm): number[] => [sourceForm.words + targetForm.words, sourceForm.text.length + targetForm.text.length, -Math.abs(sourceForm.text.length - targetForm.text.length)];
    let best: { x: EndForm; y: EndForm; score: number[] } | undefined;
    for (const sourceForm of fa) {
      for (const targetForm of fb) {
        if (sourceForm.text.length + targetForm.text.length > room) {
          continue;
        }
        const candidateScore = score(sourceForm, targetForm);
        const firstDifference = best ? candidateScore.findIndex((component, index) => component !== best!.score[index]) : 0;
        if (!best || firstDifference === -1 || candidateScore[firstDifference]! > best.score[firstDifference]!) {
          best = { x: sourceForm, y: targetForm, score: candidateScore };
        }
      }
    }
    return { ...(best ? { best: [best.x.text, best.y.text] as [string, string] } : {}), fa, fb };
  }

  private endForms(end: string, keepLast: boolean, room: number, names?: string[], closes?: RegExp): EndForm[] {
    const words = IdCut.idWords(end);
    const tail = IdCut.idWords(IdCut.keptTail(end)).length;
    const shape: WordShape = { tail, kept: keepLast ? Math.max(tail, 1) : tail, keepLast };
    const formOfWords = (): EndForm => ({ text: words.join(''), words: words.length });
    const forms: EndForm[] = end.length <= room ? [formOfWords()] : [];
    let length = end.length;
    for (let index = IdFitter.victimIndex(words, shape); index >= 0; index = IdFitter.victimIndex(words, shape)) {
      length -= this.dropWord(words, index, names);
      length -= IdFitter.dropFollowers(words, shape, closes);
      if (length <= room) {
        forms.push(formOfWords());
      }
    }
    if (length > room) {
      forms.push(formOfWords());
    }
    return forms;
  }

  private dropWord(words: string[], index: number, names?: string[]): number {
    const dropped = words.splice(index, 1)[0]!;
    if (index !== 0) {
      return dropped.length;
    }
    const next = words[0]!.replace(/^[_.-]+/, '');
    const trimmed = words[0]!.length - next.length;
    words[0] = /^[a-z]/.test(dropped) ? this.lowerFirst(next, words.slice(1).join(''), names) : next;
    return dropped.length + trimmed;
  }

  private static isLetterWord(word: string): boolean {
    return /[A-Za-z]/.test(word);
  }

  private static isNumberWord(word: string): boolean {
    return /^[_.-]*\d+$/.test(word);
  }

  private static hasOtherLetterWord(words: readonly string[], index: number, before: number): boolean {
    return words.some((other, otherIndex) => otherIndex !== index && otherIndex < before && IdFitter.isLetterWord(other));
  }

  private static separatesNumbers(words: readonly string[], index: number): boolean {
    return /\d$/.test(words[index - 1]!) && /^[_.-]*\d/.test(words[index + 1] ?? '');
  }

  private static fillerIndex(words: readonly string[], { tail, kept }: WordShape): number {
    const index = words.length - tail - 1;
    if (index < 1 || index > words.length - 1 - kept || !IdCut.isFiller(words[index]!)) {
      return -1;
    }
    if (!IdFitter.hasOtherLetterWord(words, index, words.length - tail)) {
      return -1;
    }
    return IdFitter.separatesNumbers(words, index) ? -1 : index;
  }

  private static canDrop(words: readonly string[], index: number, head: number): boolean {
    if (IdFitter.isLetterWord(words[index]!) && !IdFitter.hasOtherLetterWord(words, index, head)) {
      return false;
    }
    if (IdFitter.isNumberWord(words[index]!) && index + 1 < words.length && words.slice(index + 1).every(IdFitter.isNumberWord)) {
      return false;
    }
    return index === 0 ? /^[_.-]*[A-Za-z]/.test(words[1] ?? '') : !IdFitter.separatesNumbers(words, index);
  }

  private static victimIndex(words: readonly string[], { tail, kept, keepLast }: WordShape): number {
    const head = words.length - tail;
    for (let index = words.length - 1 - kept; index >= (keepLast ? 0 : 1); index--) {
      if (IdFitter.canDrop(words, index, head)) {
        return index;
      }
    }
    return -1;
  }

  private static dropFollowers(words: string[], shape: WordShape, closes?: RegExp): number {
    let dropped = 0;
    for (let more = true; more; ) {
      more = false;
      while (closes && !shape.kept && words.length > 1 && closes.test(words[words.length - 1]!)) {
        dropped += words.pop()!.length;
        more = true;
      }
      const fillerIndex = IdFitter.fillerIndex(words, shape);
      if (fillerIndex >= 0) {
        dropped += words.splice(fillerIndex, 1)[0]!.length;
        more = true;
      }
    }
    return dropped;
  }

  private lowerFirst(word: string, rest: string, names?: string[]): string {
    const end = `${word}${rest}`.toLowerCase();
    const tails = (names ?? []).map((_name, start) => IdSlug.camelSlug(names!.slice(start).join(' '))).reverse();
    const own = tails.find((tail) => tail.toLowerCase() === end) ?? tails.find((tail) => tail.toLowerCase().startsWith(end));
    if (own) {
      return own.slice(0, word.length);
    }
    return word.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (capitals) => capitals.toLowerCase());
  }

  private cutInside(slug: string, max: number): string {
    if (slug.length <= max) {
      return slug;
    }
    const tail = IdCut.keptTail(slug);
    const head = slug.slice(0, Math.max(max - tail.length, 0)).replace(/[_.-]+$/, '');
    if (tail && IdCut.readsApart(head, tail)) {
      return `${head}${tail}`;
    }
    return IdCut.withLetter(slug, slug.slice(0, Math.max(max, 0)).replace(/[_.-]+$/, ''), (rest) => this.cutInside(rest, max));
  }

  private sharePair(sourceEnd: string, targetEnd: string, room: number, cut: (slug: string, max: number) => string): [string, string] {
    const first = cut(sourceEnd, Math.max(Math.floor(room / 2), room - targetEnd.length));
    const second = cut(targetEnd, room - first.length);
    return [cut(sourceEnd, room - second.length), second];
  }
}

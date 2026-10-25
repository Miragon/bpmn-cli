import { camelSlug, cutAt, idWords, isFiller, keptTail, MAX_ID, nameWords, pascalSnakeSlug, readsApart, slugify, snakeSlug, withLetter } from './utils/slug.js';
import { beginAlike, lcfirst, speakingStem, stem, ucfirst } from './utils/id-words.js';
import type { Body } from './IdStyle.js';
import type { IdRequest } from './utils/requests.js';

export type IdForm = 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake';
export const FORM_JOIN: Record<IdForm, string> = { stemTo: 'To', idPair: '_', stemSnake: '_to_', idSnake: '_to_' };
export const ID_FORMS = Object.keys(FORM_JOIN) as IdForm[];

/** The longest base id 0.6 generated, so the flows it cut are still recognised. */
export const LEGACY_BASE = MAX_ID - 3;

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
  private readonly legacy: boolean;
  /** the numbers the closing end does not end on, as they would look like a collision suffix */
  private readonly closes: RegExp;
  private readonly names: string[] | undefined;

  constructor(opts: { body?: Body; legacy?: boolean; suffixSep?: string; names?: string[] } = {}) {
    this.body = opts.body ?? 'pascal';
    this.legacy = opts.legacy ?? false;
    this.closes = (opts.suffixSep ?? '_') === '' ? /^[_.-]*\d+$/ : /^_\d+$/;
    this.names = opts.names;
  }

  ends(source: string, target: string, glued: boolean): [string, string, string] {
    const legacy = this.legacy;
    switch (this.body) {
      case 'camel': {
        const a = camelSlug(source, legacy);
        return [glued ? ucfirst(a) : a, 'To', slugify(target, legacy)];
      }
      case 'snake':
        return [snakeSlug(source, legacy), '_to_', snakeSlug(target, legacy)];
      case 'pascalSnake':
        return [pascalSnakeSlug(source, legacy), '_To_', pascalSnakeSlug(target, legacy)];
      default:
        return [slugify(source, legacy), 'To', slugify(target, legacy)];
    }
  }

  /**
   * `long`: the head leaves the ends fewer than 16 characters, so it stays only where they fit
   * beside it at whole words (else Flow_; 0.6 always kept it).
   */
  namedHead(prefix: string, sep: string | undefined): { head: string; glued: boolean; long: boolean } {
    // flow12 glues the words too (flowCheckToShip); an upper-case one reads apart (F_CheckToShip)
    const glued = sep === '' && /[a-z]/.test(prefix);
    const joined = this.body === 'snake' || this.body === 'pascalSnake' ? 4 : 2;
    return { head: `${prefix}${glued ? '' : '_'}`, glued, long: !this.legacy && MAX_ID - prefix.length - (glued ? 0 : 1) - joined < 16 };
  }

  pair(head: string, a: string, join: string, b: string, max: number): string {
    const room = max - head.length - join.length;
    const [x, y] = this.legacy ? this.legacyFitPair(a, b, room) : this.fitPair(a, b, Math.max(room, 0));
    return `${head}${x}${join}${y}`;
  }

  whole(head: string, a: string, join: string, b: string, max: number): string | undefined {
    const pair = this.wholePair(a, b, max - head.length - join.length);
    return pair && `${head}${pair[0]}${join}${pair[1]}`;
  }

  /**
   * idPair and idSnake keep each end's prefix (`Task_`) and share the room after it; under 16
   * characters the whole ids share it.
   */
  idForm(form: IdForm, head: string, req: IdRequest, max: number): string {
    const s = req.source!;
    const t = req.target!;
    const join = FORM_JOIN[form];
    if (form === 'idPair' || form === 'idSnake') {
      const pa = s.length - stem(s).length;
      const pb = t.length - stem(t).length;
      const room = max - head.length - join.length - pa - pb;
      const fitter = this.ofForm(form);
      if (this.legacy || room < 16) return fitter.pair(head, s, join, t, max);
      const [x, y] = fitter.fitPair(stem(s), stem(t), room);
      return `${head}${s.slice(0, pa)}${x}${join}${t.slice(0, pb)}${y}`;
    }
    const { a, b, names } = this.stemEnds(form, req);
    return this.ofForm(form, names).pair(head, a, join, b, max);
  }

  wholeIdForm(form: IdForm, head: string, req: IdRequest, max: number): string | undefined {
    const s = req.source!;
    const t = req.target!;
    const join = FORM_JOIN[form];
    if (form === 'idPair' || form === 'idSnake') {
      const [pa, pb] = [s.length - stem(s).length, t.length - stem(t).length];
      const pair = this.ofForm(form).wholePair(stem(s), stem(t), max - head.length - join.length - pa - pb);
      return pair && `${head}${s.slice(0, pa)}${pair[0]}${join}${t.slice(0, pb)}${pair[1]}`;
    }
    const { a, b, names } = this.stemEnds(form, req);
    return this.ofForm(form, names).whole(head, a, join, b, max);
  }

  /** An end's id stem when that says something, else its label. */
  stemEnds(form: 'stemTo' | 'stemSnake', req: IdRequest): { a: string; b: string; names?: string[] } {
    const slug = (text: string): string => (form === 'stemTo' ? camelSlug(text, this.legacy) : snakeSlug(text, this.legacy));
    const byLabel = (id: string, label: string | undefined): label is string => speakingStem(id) === undefined && !!label && !!slug(label);
    const end = (id: string, label: string | undefined): string => speakingStem(id) ?? (byLabel(id, label) ? slug(label) : stem(id));
    const [a, b] = [end(req.source!, req.sourceLabel), end(req.target!, req.targetLabel)];
    if (form === 'stemSnake') return { a, b };
    return { a: lcfirst(a), b: ucfirst(b), ...(byLabel(req.source!, req.sourceLabel) ? { names: nameWords(req.sourceLabel) } : {}) };
  }

  /**
   * The first word with a letter after prefix and scope (`serviceTask_KotO_ValidatePayment` ->
   * Validate): a number would end the flow's id like a collision suffix (`To4`).
   */
  endWord(id: string, scope: string, terminal: 'Start' | 'End'): string {
    const segments = id.split('_');
    if (segments.length > 1 && new RegExp(`^${terminal}(Event)?$`, 'i').test(segments[0]!)) return terminal;
    const rest = segments.length > 1 ? segments.slice(1).filter((x) => x !== scope) : segments;
    const word = (words: string[]): string | undefined => (this.legacy ? words[0] : words.find((w) => /[A-Za-z]/.test(w)));
    return ucfirst(word(nameWords(rest.join(' '))) ?? word(nameWords(id)) ?? terminal);
  }

  private ofForm(form: IdForm, names?: string[]): IdFitter {
    return new IdFitter({ legacy: this.legacy, suffixSep: form === 'stemTo' ? '' : '_', ...(names ? { names } : {}) });
  }

  /**
   * Each end gives up words one by one, never its first or its last word with a letter, never a
   * word between two numbers (`Stufe23`); of the pairs that fit, most words, then most
   * characters, then the more even wins. Only when nothing fits is a word cut inside.
   */
  private fitPair(a: string, b: string, room: number): [string, string] {
    if (a.length + b.length <= room) return [a, b];
    const { best, fa, fb } = this.bestPair(a, b, room);
    if (best) return best;
    const [x, y] = [fa[fa.length - 1]!.text, fb[fb.length - 1]!.text];
    const long = x.length >= y.length ? 0 : 1;
    const keep = room - (long ? x : y).length;
    if (keep < 8) return this.sharePair(x, y, room, (slug, max) => this.cutInside(slug, max));
    const cut = this.cutInside(long ? y : x, keep);
    // the other end takes back what fits beside the cut
    const other = (long ? fa : fb).find((f) => f.text.length + cut.length <= room)!.text;
    return long ? [other, cut] : [cut, other];
  }

  private wholePair(a: string, b: string, room: number): [string, string] | undefined {
    if (a.length + b.length <= room) return [a, b];
    return this.bestPair(a, b, room).best;
  }

  private bestPair(a: string, b: string, room: number): { best?: [string, string]; fa: EndForm[]; fb: EndForm[] } {
    const keepLast = beginAlike(a, b);
    const [fa, fb] = [this.endForms(a, keepLast, room, this.names), this.endForms(b, keepLast, room, undefined, this.closes)];
    // later pairs win a full tie: the source has given up more
    const score = (x: EndForm, y: EndForm): number[] => [x.words + y.words, x.text.length + y.text.length, -Math.abs(x.text.length - y.text.length)];
    let best: { x: EndForm; y: EndForm; score: number[] } | undefined;
    for (const x of fa) {
      for (const y of fb) {
        if (x.text.length + y.text.length > room) continue;
        const s = score(x, y);
        const n = best ? s.findIndex((v, i) => v !== best!.score[i]) : 0;
        if (!best || n === -1 || s[n]! > best.score[n]!) best = { x, y, score: s };
      }
    }
    return { ...(best ? { best: [best.x.text, best.y.text] as [string, string] } : {}), fa, fb };
  }

  /** An end after each word it gives up, shortest last; of the forms over `room` only the last. */
  private endForms(x: string, keepLast: boolean, room: number, names?: string[], closes?: RegExp): EndForm[] {
    const words = idWords(x);
    const tail = idWords(keptTail(x)).length;
    const kept = keepLast ? Math.max(tail, 1) : tail;
    const letter = (w: string): boolean => /[A-Za-z]/.test(w);
    const number = (w: string): boolean => /^[_.-]*\d+$/.test(w);
    const filler = (): number => {
      const i = words.length - tail - 1;
      if (i < 1 || i > words.length - 1 - kept || !isFiller(words[i]!)) return -1;
      if (!words.some((w, n) => n !== i && n < words.length - tail && letter(w))) return -1;
      return /\d$/.test(words[i - 1]!) && /^[_.-]*\d/.test(words[i + 1] ?? '') ? -1 : i;
    };
    const victim = (): number => {
      const head = words.length - tail;
      for (let i = words.length - 1 - kept; i >= (keepLast ? 0 : 1); i--) {
        if (letter(words[i]!) && !words.some((w, n) => n !== i && n < head && letter(w))) continue;
        // zahlungseingang_2_2 never shrinks to zahlungseingang_2, another element's id
        if (number(words[i]!) && i + 1 < words.length && words.slice(i + 1).every(number)) continue;
        if (i === 0 ? /^[_.-]*[A-Za-z]/.test(words[1] ?? '') : !(/\d$/.test(words[i - 1]!) && /^[_.-]*\d/.test(words[i + 1] ?? ''))) return i;
      }
      return -1;
    };
    const out: EndForm[] = x.length <= room ? [{ text: x, words: words.length }] : [];
    let length = x.length;
    for (let i = victim(); i >= 0; i = victim()) {
      const [dropped] = words.splice(i, 1);
      length -= dropped!.length;
      if (i === 0) {
        const next = words[0]!.replace(/^[_.-]+/, '');
        length -= words[0]!.length - next.length;
        words[0] = /^[a-z]/.test(dropped!) ? this.lowerFirst(next, words.slice(1).join(''), names) : next;
      }
      // a trailing number that reads like a collision suffix goes too, and so does a filler word
      for (let more = true; more; ) {
        more = false;
        while (closes && !kept && words.length > 1 && closes.test(words[words.length - 1]!)) {
          length -= words.pop()!.length;
          more = true;
        }
        const f = filler();
        if (f >= 0) {
          length -= words.splice(f, 1)[0]!.length;
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
    const tails = (names ?? []).map((_, k) => camelSlug(names!.slice(k).join(' '))).reverse();
    const own = tails.find((t) => t.toLowerCase() === end) ?? tails.find((t) => t.toLowerCase().startsWith(end));
    if (own) return own.slice(0, word.length);
    return word.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (m) => m.toLowerCase());
  }

  /** Keeps the join or number tail (`3Zahlungseingangsbest2024`) where the two read apart. */
  private cutInside(slug: string, max: number): string {
    if (slug.length <= max) return slug;
    const tail = keptTail(slug);
    const head = slug.slice(0, Math.max(max - tail.length, 0)).replace(/[_.-]+$/, '');
    if (tail && readsApart(head, tail)) return `${head}${tail}`;
    return withLetter(slug, slug.slice(0, Math.max(max, 0)).replace(/[_.-]+$/, ''), (rest) => this.cutInside(rest, max));
  }

  /** fitPair as 0.6 cut the ends, to recognise the flows it named. */
  private legacyFitPair(a: string, b: string, room: number): [string, string] {
    if (a.length + b.length <= room) return [a, b];
    // ends that begin alike differ at their ends, so each keeps its last word
    return this.sharePair(a, b, room, beginAlike(a, b) ? (slug, max) => this.cutKeepingLast(slug, max) : (slug, max) => this.legacyCut(slug, max));
  }

  /** The first end gets at least half, the second the rest, the first what the second leaves. */
  private sharePair(a: string, b: string, room: number, cut: (slug: string, max: number) => string): [string, string] {
    const first = cut(a, Math.max(Math.floor(room / 2), room - b.length));
    const second = cut(b, room - first.length);
    return [cut(a, room - second.length), second];
  }

  private cutKeepingLast(slug: string, max: number): string {
    if (slug.length <= max) return slug;
    const m = /^(.*[a-z0-9])([_.-][A-Za-z0-9]+|[A-Z][a-z0-9]+)$/.exec(slug);
    if (!m || m[2]!.length + 8 > max) return this.legacyCut(slug, max);
    return `${this.legacyCut(m[1]!, max - m[2]!.length)}${m[2]}`;
  }

  private legacyCut(slug: string, max: number): string {
    return cutAt(slug, max, true);
  }
}

import { camelSlug, cutAt, idWords, isFiller, keptTail, MAX_ID, nameWords, pascalSnakeSlug, readsApart, slugify, snakeSlug, withLetter } from './utils/slug.js';
import { beginAlike, lcfirst, speakingStem, stem, ucfirst } from './utils/id-words.js';
import type { Body } from './IdStyle.js';
import type { IdRequest } from './utils/requests.js';

/** The flow forms built from the ends' ids or id stems, and the word between the ends. */
export type IdForm = 'stemTo' | 'idPair' | 'stemSnake' | 'idSnake';
export const FORM_JOIN: Record<IdForm, string> = { stemTo: 'To', idPair: '_', stemSnake: '_to_', idSnake: '_to_' };
export const ID_FORMS = Object.keys(FORM_JOIN) as IdForm[];

/** The longest base id 0.6 and earlier generated (MAX_ID less room for a collision suffix `_99`): FlowIdFollower still recognises the flows it cut. */
export const LEGACY_BASE = MAX_ID - 3;

/** An end as fitPair cuts it: its text and the number of its words (idWords as it gave them up). */
interface EndForm {
  text: string;
  words: number;
}

export class IdFitter {
  private readonly body: Body;
  private readonly legacy: boolean;
  /** the numbers fitPair's closing end does not end on (a collision suffix's look): any where the suffix is glued (`2`: stemTo, scopedTo), a separated one where it is `_2` */
  private readonly closes: RegExp;
  private readonly names: string[] | undefined;

  constructor(opts: { body?: Body; legacy?: boolean; suffixSep?: string; names?: string[] } = {}) {
    this.body = opts.body ?? 'pascal';
    this.legacy = opts.legacy ?? false;
    this.closes = (opts.suffixSep ?? '_') === '' ? /^[_.-]*\d+$/ : /^_\d+$/;
    this.names = opts.names;
  }

  /** The ends of a `named` flow in the body case and the word between them (`CheckInvoice`, `To`, `BookInvoice`; `legacy`: slugs cut as 0.6 cut them). */
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
   * The head of a `named` flow's id in the body case (namedBase), whether its ends
   * are glued to it, and whether it is `long`: it leaves the ends fewer than
   * 16 of the 64 characters, so it stays only where they fit beside it at
   * whole words (else the default Flow_; never for `legacy`, 0.6 kept it).
   */
  namedHead(prefix: string, sep: string | undefined): { head: string; glued: boolean; long: boolean } {
    // a number glued to a lower-case prefix (flow12) glues the words too (flowCheckToShip); an upper-case one reads apart (F12 -> F_CheckToShip)
    const glued = sep === '' && /[a-z]/.test(prefix);
    const joined = this.body === 'snake' || this.body === 'pascalSnake' ? 4 : 2;
    return { head: `${prefix}${glued ? '' : '_'}`, glued, long: !this.legacy && MAX_ID - prefix.length - (glued ? 0 : 1) - joined < 16 };
  }

  /** `<head><a><join><b>`, the two ends sharing the room up to `max` (`legacy`: as 0.6 cut, legacyFitPair; else fitPair). */
  pair(head: string, a: string, join: string, b: string, max: number): string {
    const room = max - head.length - join.length;
    const [x, y] = this.legacy ? this.legacyFitPair(a, b, room) : this.fitPair(a, b, Math.max(room, 0));
    return `${head}${x}${join}${y}`;
  }

  /** pair where the ends fit at whole words (wholePair): undefined where a word of theirs would be cut inside. */
  whole(head: string, a: string, join: string, b: string, max: number): string | undefined {
    const pair = this.wholePair(a, b, max - head.length - join.length);
    return pair && `${head}${pair[0]}${join}${pair[1]}`;
  }

  /**
   * The base of a flow in a form built from its ends' ids (stemTo, idPair,
   * stemSnake, idSnake) after `head` (`<prefix>_`, or a declared prefix), at
   * most `max` characters (`legacy`: cut as 0.6 cut). The stem forms write
   * an end whose id says nothing from its label; idPair and idSnake keep
   * each id's prefix (`Task_`) and share the room among the words after it
   * (0.6, and a room under 16: the whole ids share it, so the words of a
   * prefix can go too).
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

  /** idForm where the ends fit at whole words after their prefixes (wholePair; idPair and idSnake never share the room of the whole ids): undefined where they do not. */
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

  /**
   * The ends of a stem form (stemTo: camelCase, the source in lower case;
   * stemSnake: snake_case): an end's id stem when that says something, else
   * its label (`names`: the source's name words, where it is written from
   * its label in camelCase).
   */
  stemEnds(form: 'stemTo' | 'stemSnake', req: IdRequest): { a: string; b: string; names?: string[] } {
    const slug = (text: string): string => (form === 'stemTo' ? camelSlug(text, this.legacy) : snakeSlug(text, this.legacy));
    /** whether an end is written from its label (its id says nothing) */
    const byLabel = (id: string, label: string | undefined): label is string => speakingStem(id) === undefined && !!label && !!slug(label);
    const end = (id: string, label: string | undefined): string => speakingStem(id) ?? (byLabel(id, label) ? slug(label) : stem(id));
    const [a, b] = [end(req.source!, req.sourceLabel), end(req.target!, req.targetLabel)];
    if (form === 'stemSnake') return { a, b };
    return { a: lcfirst(a), b: ucfirst(b), ...(byLabel(req.source!, req.sourceLabel) ? { names: nameWords(req.sourceLabel) } : {}) };
  }

  /**
   * The word a scopedTo flow uses for one of its ends: Start / End for a start
   * / end event (`startEvent_KotOrder`, `EndEvent_Failed`), else the first word
   * with a letter of the id after its prefix and the scope
   * (`serviceTask_KotO_ValidatePayment` -> Validate, `task_KotO_4AugenPruefen`
   * -> Augen: a number would end the flow's id like a collision suffix, `To4`).
   * `legacy`: the first word, as 0.6 took it (derivedBases).
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
   * Two ends that share `room` characters, cut at whole words. Each end can
   * give up its words one after the other (endForms): the last word before
   * the join or number it ends with (keptTail), never its first word, never
   * its last word with a letter before that join or number
   * (`2Lieferantenbestellungen` keeps both, `LieferantenbestellungenJoin`
   * never shrinks to `Join`), never a word between two numbers (the two would
   * read as one: `Stufe2Freigabe3` gives up the 2 first, never `Stufe23`; nor
   * `stufe_2_2` for `stufe_2_pruefung_2`, which reads like a suffixed id),
   * never the numbers before a number tail (`zahlungseingang_2_2` never names
   * `zahlungseingang_2`, another element, whose suffix skipped `_2`); a
   * number the given-up word leaves at the end of the id goes with it where it
   * reads like a collision suffix (`closes`, the target's: a separated `_4`
   * where the suffix is `_2`, `archivieren` for `archivieren_100_4_augen`,
   * never `archivieren_100`; any number where the suffix is glued, stemTo and
   * scopedTo), and stays elsewhere (`Phase1To...`, `V2To...`); a filler word
   * (isFiller: und, an, the) a given-up word leaves at the end of the end, or
   * before its Join or number, goes too (`lieferung_versenden`, never
   * `lieferung_versenden_und`; not the first word). Ends that begin
   * with the same word (the unnamed elements after one anchor:
   * after_check_gateway, after_check_gateway_task) differ at their ends: each
   * keeps its last word (a join with a number: both) and gives up the word
   * before it, down to its first (`SynchronisierenTo...` for
   * `LieferantenbestellungenSynchronisieren`). Of the forms of the two ends
   * that fit beside each other, the pair with the most words is taken, then
   * the one with the most characters, then the more even one, then the one
   * where the source gave up more (`SynchronisierenToRechnungLieferantenbestellungen`
   * for `Synchronisieren aktualisieren` and `Rechnung Lieferantenbestellungen`:
   * the short word goes, not the long one). Only when even the shortest forms
   * do not fit, a word is cut inside (cutInside, which keeps the join or
   * number at the end): in the longer end where the other fits whole and it
   * keeps 8 characters, else in both (sharePair). `names`: the name words an
   * end was written from with camelSlug, so that an end without its first
   * word starts as camelSlug writes it (`urlPDFVersenden` for URL PDF
   * versenden). Deterministic.
   */
  private fitPair(a: string, b: string, room: number): [string, string] {
    if (a.length + b.length <= room) return [a, b];
    const { best, fa, fb } = this.bestPair(a, b, room);
    if (best) return best;
    // even the shortest forms do not fit: a word is cut inside, in the longer end where the other fits whole
    const [x, y] = [fa[fa.length - 1]!.text, fb[fb.length - 1]!.text];
    const long = x.length >= y.length ? 0 : 1;
    const keep = room - (long ? x : y).length;
    if (keep < 8) return this.sharePair(x, y, room, (slug, max) => this.cutInside(slug, max));
    const cut = this.cutInside(long ? y : x, keep);
    // the other end takes back what fits beside the cut (more than its shortest form only where the cut ends short of `keep`)
    const other = (long ? fa : fb).find((f) => f.text.length + cut.length <= room)!.text;
    return long ? [other, cut] : [cut, other];
  }

  /** fitPair at whole words only (a long head stays only where the ends fit beside it so: IdStyle.connectionBase): undefined where even the shortest forms of the ends do not fit beside each other. */
  private wholePair(a: string, b: string, room: number): [string, string] | undefined {
    if (a.length + b.length <= room) return [a, b];
    return this.bestPair(a, b, room).best;
  }

  /** The forms of two ends (endForms) and, of the pairs that fit into `room`, the best (fitPair's order); no best where none fits. */
  private bestPair(a: string, b: string, room: number): { best?: [string, string]; fa: EndForm[]; fb: EndForm[] } {
    const keepLast = beginAlike(a, b);
    const [fa, fb] = [this.endForms(a, keepLast, room, this.names), this.endForms(b, keepLast, room, undefined, this.closes)];
    /** most words, most characters, the more even pair; later pairs win a full tie (the source has given up more) */
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

  /**
   * An end as it is and after each word it gives up, the shortest last (the
   * rules: fitPair; `closes`: the numbers that would read like a collision
   * suffix at the end of the id, for the end that closes it). Of the forms
   * longer than `room`, which fit beside no other, only the shortest is
   * listed (a long id's end lists only what can fit).
   */
  private endForms(x: string, keepLast: boolean, room: number, names?: string[], closes?: RegExp): EndForm[] {
    const words = idWords(x);
    const tail = idWords(keptTail(x)).length;
    const kept = keepLast ? Math.max(tail, 1) : tail;
    const letter = (w: string): boolean => /[A-Za-z]/.test(w);
    const number = (w: string): boolean => /^[_.-]*\d+$/.test(w);
    /** the index of a filler word a cut form would end on (the last before the Join / number tail, not kept, not the first, not the last with a letter, not between two numbers); -1 for none */
    const filler = (): number => {
      const i = words.length - tail - 1;
      if (i < 1 || i > words.length - 1 - kept || !isFiller(words[i]!)) return -1;
      if (!words.some((w, n) => n !== i && n < words.length - tail && letter(w))) return -1;
      return /\d$/.test(words[i - 1]!) && /^[_.-]*\d/.test(words[i + 1] ?? '') ? -1 : i;
    };
    /** the index of the word given up next, -1 for none */
    const victim = (): number => {
      const head = words.length - tail;
      for (let i = words.length - 1 - kept; i >= (keepLast ? 0 : 1); i--) {
        // the last word with a letter before the Join / number tail stays
        if (letter(words[i]!) && !words.some((w, n) => n !== i && n < head && letter(w))) continue;
        // so do the numbers before a number tail (zahlungseingang_2_2 never shrinks to zahlungseingang_2, another element's
        // id, which a suffix would then make the base again)
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
        // without its first word an end starts with the next one, without a separator and in the case the end began with
        // (a camel stemTo end: synchronisierenTo..., urlCheckTo... as camelSlug writes it)
        const next = words[0]!.replace(/^[_.-]+/, '');
        length -= words[0]!.length - next.length;
        words[0] = /^[a-z]/.test(dropped!) ? this.lowerFirst(next, words.slice(1).join(''), names) : next;
      }
      // a number the given-up word leaves at the end of the id goes too where it reads like a collision suffix, and a filler
      // word the cut would end on (`..._versenden_und`, `...KundenAn`)
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
   * The first word of an end that lost its first one, lower-cased as camelSlug
   * writes a first word (`Versenden` -> versenden, `URLCheck` -> urlCheck).
   * `names`: the words the end was written from, which tell where a run of
   * capitals ends (`URLPDFVersenden` + URL PDF versenden -> urlPDFVersenden;
   * also where camelSlug cut the name at 40 and the end is a run of its middle
   * words); without them the run is lowered whole (urlpdfVersenden, as
   * camelSlug writes the slug).
   */
  private lowerFirst(word: string, rest: string, names?: string[]): string {
    const end = `${word}${rest}`.toLowerCase();
    const tails = (names ?? []).map((_, k) => camelSlug(names!.slice(k).join(' '))).reverse();
    const own = tails.find((t) => t.toLowerCase() === end) ?? tails.find((t) => t.toLowerCase().startsWith(end));
    if (own) return own.slice(0, word.length);
    return word.replace(/^[A-Z]+(?![a-z])|^[A-Z]/, (m) => m.toLowerCase());
  }

  /**
   * An end cut inside a word to at most `max` characters (fitPair, once no
   * end has a whole word left to give up): its first characters and the join
   * or number it ends with (`3Zahlungseingangsbest2024`), where the two read
   * apart (readsApart: never `32024`), else its first `max` characters.
   */
  private cutInside(slug: string, max: number): string {
    if (slug.length <= max) return slug;
    const tail = keptTail(slug);
    const head = slug.slice(0, Math.max(max - tail.length, 0)).replace(/[_.-]+$/, '');
    if (tail && readsApart(head, tail)) return `${head}${tail}`;
    // a room that ends inside a leading number: the end starts at its first word with a letter (withLetter)
    return withLetter(slug, slug.slice(0, Math.max(max, 0)).replace(/[_.-]+$/, ''), (rest) => this.cutInside(rest, max));
  }

  /** fitPair as 0.6 and earlier cut the ends (inside a word where a kept last word left no room for a whole one); only derivedBases uses it, to recognise the flows it named. */
  private legacyFitPair(a: string, b: string, room: number): [string, string] {
    if (a.length + b.length <= room) return [a, b];
    // ends that begin alike (the unnamed elements after one anchor: after_check_gateway, after_check_gateway_task) differ
    // at their ends: a cut there would make them read alike, so it cuts inside and keeps each end's last word
    return this.sharePair(a, b, room, beginAlike(a, b) ? (slug, max) => this.cutKeepingLast(slug, max) : (slug, max) => this.legacyCut(slug, max));
  }

  /** Two ends that share the room by characters (legacyFitPair; fitPair once even the shortest forms do not fit and the shorter end leaves the longer under 8 characters): the first end at least half, the second what is left, the first what the second leaves over. */
  private sharePair(a: string, b: string, room: number, cut: (slug: string, max: number) => string): [string, string] {
    const first = cut(a, Math.max(Math.floor(room / 2), room - b.length));
    const second = cut(b, room - first.length);
    return [cut(a, room - second.length), second];
  }

  /** cutAt that keeps the slug's last word (`after_check_order_gateway_task`, 25 -> `after_check_order_task`), as 0.6 cut (legacyFitPair). */
  private cutKeepingLast(slug: string, max: number): string {
    if (slug.length <= max) return slug;
    const m = /^(.*[a-z0-9])([_.-][A-Za-z0-9]+|[A-Z][a-z0-9]+)$/.exec(slug);
    if (!m || m[2]!.length + 8 > max) return this.legacyCut(slug, max);
    return `${this.legacyCut(m[1]!, max - m[2]!.length)}${m[2]}`;
  }

  /** cutAt as 0.6 cut (legacyFitPair, derivedBases). */
  private legacyCut(slug: string, max: number): string {
    return cutAt(slug, max, true);
  }
}

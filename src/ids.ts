/**
 * Id building blocks: name words, slugs, the id registry.
 *
 * Which id a new element gets is decided by the file's id style
 * (src/idstyle.ts): new ids follow the conventions the file already uses,
 * and a file without a convention gets the bpmn-cli default
 * (`Activity_CheckInvoice`, `Flow_CheckInvoiceToBookInvoice`).
 *
 * Names become ASCII words: German umlauts are transliterated (ä -> ae,
 * ö -> oe, ü -> ue, ß -> ss; Ä -> Ae, or AE inside an upper-case word), so
 * are the letters NFKD does not decompose or decomposes to one letter where
 * the language writes two (Nordic ø -> oe, å -> aa, æ -> ae; œ -> oe,
 * ł -> l, đ / ð -> d, þ -> th, ı -> i), other accents are dropped (é -> e),
 * everything that is not a letter or digit separates words. A generated id
 * is at most MAX_ID characters long: slugs are cut at whole words (cutAt;
 * inside a word only where one word alone does not fit, or where the whole
 * words that fit would keep no letter), the same way for the same input.
 */

/** The longest slug of a name or context (an id body before the prefix). */
export const MAX_SLUG = 40;

/** The longest id the id style generates, a collision suffix included (src/idstyle.ts). */
export const MAX_ID = 64;

/** Letters that are spelled out (Å -> Aa, not the A NFKD would leave). */
const SPELLED: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ẞ: 'SS',
  ø: 'oe',
  Ø: 'Oe',
  å: 'aa',
  Å: 'Aa',
  æ: 'ae',
  Æ: 'Ae',
  œ: 'oe',
  Œ: 'Oe',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
};
const SPELLED_RE = new RegExp(`[${Object.keys(SPELLED).join('')}]`, 'g');

/** The ASCII transliteration of a name (see the module header: umlauts and Nordic letters spelled out, other accents dropped). */
export function transliterate(name: string): string {
  return name
    .normalize('NFC')
    .replace(SPELLED_RE, (c, at: number, all: string) => {
      const out = SPELLED[c]!;
      // Ä in an upper-case word (ÄNDERUNG) -> AE, Ø in ØRE -> OE
      const next = all.charAt(at + 1);
      return out.length === 2 && c === c.toUpperCase() && next && next !== next.toLowerCase() ? out.toUpperCase() : out;
    })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** The ASCII words of a name (see transliterate; `OrderReceived` and `URLCheck` are two words each); [] when nothing usable remains. */
export function nameWords(name: string | undefined): string[] {
  if (!name) return [];
  return transliterate(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** Whether a name gives an id words: at least one of its words has a letter (`123` or `✓✓✓` do not; an id is never a bare number). */
export function hasIdWords(name: string | undefined): boolean {
  return nameWords(name).some((w) => /[A-Za-z]/.test(w));
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** The end of a slug that tells it apart from its neighbours and survives a cut: a join (`Join`, `_join`) and / or a number (`_2`, `2`). */
const KEPT_TAIL = /(?:(?<=[a-z0-9])Join|_[Jj]oin)?(?:(?<=[A-Za-z])\d+|_\d+)?$/;

/**
 * Cuts an id or a slug to at most `max` characters at the last word
 * boundary that fits (idWords), without a trailing separator; a first word
 * longer than `max` is cut inside. A join or number at its end is kept
 * (`...ErstellenJoin` -> `...Join`), so the cut keeps what tells it apart.
 * A cut keeps a letter: where the whole words that fit have none (a leading
 * number, `2URLCheck...`), or end in a number the kept one would run into
 * (`10Warenwirtschaftssystemabgleich10` -> never `1010`), the next word is
 * cut inside to fill the room. Deterministic: the same input gives the same
 * result. `legacy`: as 0.6 cut, without that guard (recognising the ids it
 * wrote).
 */
export function cutAt(slug: string, max: number, legacy = false): string {
  if (slug.length <= max) return slug;
  const tail = keptTail(slug);
  if (tail && max - tail.length >= 8) {
    const head = slug.slice(0, -tail.length);
    const cut = cutWords(head, max - tail.length, legacy);
    if (legacy || readsApart(cut, tail)) return `${cut}${tail}`;
    const inside = trimSeparators(head.slice(0, max - tail.length));
    if (readsApart(inside, tail)) return `${inside}${tail}`;
  }
  return cutWords(slug, max, legacy);
}

/** Whether a cut head and the tail kept after it read as words: the head has a letter and does not run into a number tail as one number (`Stufe2` + `3`). */
export function readsApart(head: string, tail: string): boolean {
  return /[A-Za-z]/.test(head) && !(/\d$/.test(head) && /^\d/.test(tail));
}

const trimSeparators = (slug: string): string => slug.replace(/[_.-]+$/, '');

/** cutAt without keeping a tail: the slug's first words (idWords) that fit, else (none, or no letter among them) its first `max` characters. */
function cutWords(slug: string, max: number, legacy = false): string {
  if (slug.length <= max) return slug;
  if (legacy) return legacyCutWords(slug, max);
  let out = '';
  for (const w of idWords(slug)) {
    if (out.length + w.length > max) break;
    out += w;
  }
  return trimSeparators(out && /[A-Za-z]/.test(out) ? out : slug.slice(0, Math.max(max, 0)));
}

/** cutWords as 0.6 cut: at the last boundary that fits, also the one right after a separator (a slug that begins with `_` and whose first word does not fit is cut to ''). */
function legacyCutWords(slug: string, max: number): string {
  let best = 0;
  for (let i = 1; i <= max; i++) {
    const prev = slug.charAt(i - 1);
    const c = slug.charAt(i);
    const boundary = /[_.-]/.test(c) || (/[A-Z]/.test(c) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(c) && /[A-Za-z]/.test(prev)) || /[_.-]/.test(prev);
    if (boundary) best = i;
  }
  return trimSeparators(best > 0 ? slug.slice(0, best) : slug.slice(0, max));
}

/**
 * The words of an id or a slug, the ones cutAt keeps or drops, each with
 * the separator before it: a word begins at `_`, `-` or `.`, at an
 * upper-case letter after a lower-case letter or a digit, and at a digit
 * after a letter (`check_invoice` -> check, _invoice; `CheckInvoice2` ->
 * Check, Invoice, 2; `URLCheck` is one word). Joined they give the slug
 * again.
 */
export function idWords(slug: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 1; i < slug.length; i++) {
    const prev = slug.charAt(i - 1);
    const c = slug.charAt(i);
    if (/[_.-]/.test(prev)) continue;
    const boundary = /[_.-]/.test(c) || (/[A-Z]/.test(c) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(c) && /[A-Za-z]/.test(prev));
    if (boundary) {
      out.push(slug.slice(start, i));
      start = i;
    }
  }
  if (slug) out.push(slug.slice(start));
  return out;
}

/** The join and / or number at the end of a slug that cutAt keeps (`CheckJoin` -> Join, `Check_2` -> _2); '' for none, or when it is the whole slug (`2`). */
export function keptTail(slug: string): string {
  const tail = KEPT_TAIL.exec(slug)?.[0] ?? '';
  return tail.length < slug.length ? tail : '';
}

/** Cuts a slug to MAX_SLUG characters at a word boundary (`legacy`: as 0.6 cut, cutAt; the slugs below take it too, for recognising the flows 0.6 named). */
function cut(slug: string, legacy = false): string {
  return cutAt(slug, MAX_SLUG, legacy);
}

/** ASCII-only PascalCase slug of a name, or '' when nothing usable remains (the bpmn-cli default body). */
export function slugify(name: string | undefined, legacy = false): string {
  return cut(nameWords(name).map(cap).join(''), legacy);
}

/** camelCase slug: `checkInvoice` (an upper-case first word is lowered: `URL check` -> `urlCheck`). */
export function camelSlug(name: string | undefined, legacy = false): string {
  const words = nameWords(name);
  if (!words.length) return '';
  const [first, ...rest] = words;
  const head = /^[A-Z0-9]+$/.test(first!) ? first!.toLowerCase() : first!.charAt(0).toLowerCase() + first!.slice(1);
  return cut(head + rest.map(cap).join(''), legacy);
}

/** snake_case slug: `check_invoice`. */
export function snakeSlug(name: string | undefined, legacy = false): string {
  return cut(
    nameWords(name)
      .map((w) => w.toLowerCase())
      .join('_'),
    legacy,
  );
}

/** Pascal_Snake slug: `Check_Invoice`. */
export function pascalSnakeSlug(name: string | undefined, legacy = false): string {
  return cut(nameWords(name).map(cap).join('_'), legacy);
}

/** Edit distance with adjacent transpositions (optimal string alignment; small strings only). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** The typos two spellings of one word may differ by: none below 5 characters, 1 up to 11, 2 from 12. */
export function typoTolerance(length: number): number {
  return length >= 12 ? 2 : length >= 5 ? 1 : 0;
}

/** BPMN ids must be XML NCNames. */
export function isValidId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
}

/** Every id of the document (BPMN, DI and vendor ids), so that a new id never collides. */
export class IdRegistry {
  private readonly used = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const id of existing) this.used.add(id);
  }

  has(id: string): boolean {
    return this.used.has(id);
  }

  claim(id: string): void {
    this.used.add(id);
  }

  release(id: string): void {
    this.used.delete(id);
  }

  /** The ids in use. */
  values(): IterableIterator<string> {
    return this.used.values();
  }
}

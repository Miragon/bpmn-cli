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
 * is at most MAX_ID characters long: slugs are cut at a word boundary
 * (cutAt), the same way for the same input.
 */

const MAX_SLUG = 40;

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
 * boundary that fits (before an upper-case letter that follows a lower-case
 * letter or a digit, before a digit that follows a letter, at `_`, `-` or
 * `.`), without a trailing separator; a first word longer than `max` is cut
 * inside. A join or number at its end is kept (`...ErstellenJoin` ->
 * `...Join`), so the cut keeps what tells it apart. Deterministic: the same
 * input gives the same result.
 */
export function cutAt(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const tail = KEPT_TAIL.exec(slug)?.[0] ?? '';
  if (tail && tail.length < slug.length && max - tail.length >= 8) return `${cutWords(slug.slice(0, -tail.length), max - tail.length)}${tail}`;
  return cutWords(slug, max);
}

/** cutAt without keeping a tail. */
function cutWords(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  let best = 0;
  for (let i = 1; i <= max; i++) {
    const prev = slug.charAt(i - 1);
    const c = slug.charAt(i);
    const boundary = /[_.-]/.test(c) || (/[A-Z]/.test(c) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(c) && /[A-Za-z]/.test(prev)) || /[_.-]/.test(prev);
    if (boundary) best = i;
  }
  return (best > 0 ? slug.slice(0, best) : slug.slice(0, max)).replace(/[_.-]+$/, '');
}

/** Cuts a slug to MAX_SLUG characters at a word boundary. */
function cut(slug: string): string {
  return cutAt(slug, MAX_SLUG);
}

/** ASCII-only PascalCase slug of a name, or '' when nothing usable remains (the bpmn-cli default body). */
export function slugify(name: string | undefined): string {
  return cut(nameWords(name).map(cap).join(''));
}

/** camelCase slug: `checkInvoice` (an upper-case first word is lowered: `URL check` -> `urlCheck`). */
export function camelSlug(name: string | undefined): string {
  const words = nameWords(name);
  if (!words.length) return '';
  const [first, ...rest] = words;
  const head = /^[A-Z0-9]+$/.test(first!) ? first!.toLowerCase() : first!.charAt(0).toLowerCase() + first!.slice(1);
  return cut(head + rest.map(cap).join(''));
}

/** snake_case slug: `check_invoice`. */
export function snakeSlug(name: string | undefined): string {
  return cut(
    nameWords(name)
      .map((w) => w.toLowerCase())
      .join('_'),
  );
}

/** Pascal_Snake slug: `Check_Invoice`. */
export function pascalSnakeSlug(name: string | undefined): string {
  return cut(nameWords(name).map(cap).join('_'));
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

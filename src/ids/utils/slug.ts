/**
 * Id building blocks: name words and slugs.
 *
 * Which id a new element gets is decided by the file's id style
 * (src/ids/style.ts): new ids follow the conventions the file already uses,
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
 * words that fit would keep no letter; a room that ends inside a leading
 * number starts at the first word with a letter, withLetter), the same way
 * for the same input; a name or a body cut so never ends on a filler word
 * (cutName: und, an, the).
 */

/** The longest slug of a name or context (an id body before the prefix). */
export const MAX_SLUG = 40;

/** The longest id the id style generates, a collision suffix included (src/ids/style.ts). */
export const MAX_ID = 64;

/**
 * Function words a cut never ends on (cutName, the ends of a flow:
 * src/ids/style.ts fitPair), German and English: `LieferantenbestellungVersenden`,
 * never `...VersendenUnd`.
 */
const FILLERS = new Set(['und', 'oder', 'an', 'am', 'auf', 'aus', 'bei', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'fuer', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'im', 'in', 'and', 'or', 'of', 'to', 'the', 'a', 'for', 'with', 'on', 'at', 'by']);

/** Whether a word of an id (idWords: `Und`, `_und`) is a filler word a cut does not end on. */
export function isFiller(word: string): boolean {
  return FILLERS.has(word.replace(/^[_.-]+/, '').toLowerCase());
}

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
 * wrote). `names`: cutName.
 */
export function cutAt(slug: string, max: number, legacy = false, names = false): string {
  if (slug.length <= max) return slug;
  const tail = keptTail(slug);
  if (tail && max - tail.length >= 8) {
    const head = slug.slice(0, -tail.length);
    const cut = cutWords(head, max - tail.length, legacy, names);
    if (legacy || readsApart(cut, tail)) return `${cut}${tail}`;
    // a filler word between a number and the number tail stays: it keeps them apart (`StartAfter2Und2`, never a word
    // cut inside)
    const kept = names ? cutWords(head, max - tail.length) : cut;
    if (readsApart(kept, tail)) return `${kept}${tail}`;
    const inside = trimSeparators(head.slice(0, max - tail.length));
    if (readsApart(inside, tail)) return `${inside}${tail}`;
  }
  return cutWords(slug, max, legacy, names);
}

/**
 * cutAt for a name's or a context's words (the slug of a name, an id's body
 * cut to the room its prefix leaves): the words that fit, but never a filler
 * word at the end of the cut (`LieferantenbestellungVersenden` for
 * Lieferantenbestellung versenden und Zahlungseingang prüfen, 0.6:
 * `...VersendenUnd`); the first word stays, and so does one between a
 * number and the number tail it keeps apart (`StartAfter2Und2`).
 */
export function cutName(slug: string, max: number): string {
  return cutAt(slug, max, false, true);
}

/** Whether a cut head and the tail kept after it read as words: the head has a letter and does not run into a number tail as one number (`Stufe2` + `3`). */
export function readsApart(head: string, tail: string): boolean {
  return /[A-Za-z]/.test(head) && !(/\d$/.test(head) && /^\d/.test(tail));
}

const trimSeparators = (slug: string): string => slug.replace(/[_.-]+$/, '');

/** cutAt without keeping a tail: the slug's first words (idWords) that fit (`names`: not ending on a filler word), else (none, or no letter among them) its first `max` characters. */
function cutWords(slug: string, max: number, legacy = false, names = false): string {
  if (slug.length <= max) return slug;
  if (legacy) return legacyCutWords(slug, max);
  const words: string[] = [];
  let length = 0;
  for (const w of idWords(slug)) {
    if (length + w.length > max) break;
    words.push(w);
    length += w.length;
  }
  // a filler word at the end of the cut goes too (never the first word, never the last word with a letter)
  if (names) while (words.length > 1 && isFiller(words[words.length - 1]!) && words.slice(0, -1).some((w) => /[A-Za-z]/.test(w))) words.pop();
  const out = words.join('');
  if (out && /[A-Za-z]/.test(out)) return trimSeparators(out);
  return trimSeparators(withLetter(slug, slug.slice(0, Math.max(max, 0)), (rest) => cutWords(rest, max, false, names)));
}

/**
 * A cut that keeps no letter (the room ends inside a leading number:
 * `10202422024` for 10202422024 Rechnung in 11 characters) starts at the
 * slug's first word with a letter instead, the number words before it
 * dropped (`Rechnung`; `again` cuts that rest); any other cut as it is.
 */
export function withLetter(slug: string, cut: string, again: (rest: string) => string): string {
  if (/[A-Za-z]/.test(cut)) return cut;
  const words = idWords(slug);
  const at = words.findIndex((w) => /[A-Za-z]/.test(w));
  return at > 0 ? again(words.slice(at).join('').replace(/^[_.-]+/, '')) : cut;
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

/** Cuts a slug to MAX_SLUG characters at a word boundary, never after a filler word (cutName; `legacy`: as 0.6 cut, cutAt; the slugs below take it too, for recognising the flows 0.6 named). */
function cut(slug: string, legacy = false): string {
  return legacy ? cutAt(slug, MAX_SLUG, true) : cutName(slug, MAX_SLUG);
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

/**
 * The letter word between a base that ends in a digit and a glued collision
 * number (`serviceTask_step1No2`, never `serviceTask_step12`, which reads as
 * the id of Step 12).
 */
export const SUFFIX_WORD = 'No';

/**
 * `base` with the collision suffix `n` after `sep` (`_2`; '' glues it:
 * `checkInvoice2`), within MAX_ID: a base that leaves the suffix no room is
 * cut (`cut`, by default cutAt). A glued number after a base that ends in a
 * digit gets SUFFIX_WORD before it (`step1No2`), where the cut base still
 * ends in one.
 */
export function withSuffix(base: string, sep: string, n: number, cut: (max: number) => string = (max) => cutAt(base, max)): string {
  const fit = (suffix: string): string => (base.length + suffix.length <= MAX_ID ? base : cut(MAX_ID - suffix.length));
  if (sep !== '') return `${fit(`${sep}${n}`)}${sep}${n}`;
  const glued = fit(`${n}`);
  if (!/\d$/.test(glued)) return `${glued}${n}`;
  const worded = fit(`${SUFFIX_WORD}${n}`);
  return /\d$/.test(worded) ? `${worded}${SUFFIX_WORD}${n}` : `${worded}${n}`;
}

/**
 * Whether `rest`, what an id has after `base`, is a collision suffix `sep`
 * gives (`_2`, a glued `2`; after a base that ends in a digit also
 * `No2`); `either`: `_2` or a glued one (a flow's id, whose separator the
 * reader does not know).
 */
export function isSuffix(base: string, rest: string, sep: string | 'either'): boolean {
  const word = /\d$/.test(base) ? `(?:${SUFFIX_WORD})?` : '';
  if (sep === 'either') return new RegExp(`^(?:_|${word})\\d+$`).test(rest);
  return new RegExp(sep === '' ? `^${word}\\d+$` : `^${sep}\\d+$`).test(rest);
}

/** BPMN ids must be XML NCNames. */
export function isValidId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
}

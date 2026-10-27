/**
 * Names become ASCII id words: umlauts and Nordic letters are spelled out (ä -> ae, ø -> oe),
 * other accents dropped. Cuts happen at whole words, deterministically, never on a filler word.
 */

export const MAX_SLUG = 40;

/** The longest generated id, a collision suffix included. */
export const MAX_ID = 64;

/** Function words a cut never ends on: `BestellungVersenden`, never `...VersendenUnd`. */
const FILLERS = new Set(['und', 'oder', 'an', 'am', 'auf', 'aus', 'bei', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'fuer', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'im', 'in', 'and', 'or', 'of', 'to', 'the', 'a', 'for', 'with', 'on', 'at', 'by']);

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

/** Spells out special letters; in an upper-case word both letters are upper case (ÄNDERUNG -> AENDERUNG, ØRE -> OERE). */
export function transliterate(name: string): string {
  return name
    .normalize('NFC')
    .replace(SPELLED_RE, (character, at: number, all: string) => {
      const out = SPELLED[character]!;
      const next = all.charAt(at + 1);
      return out.length === 2 && character === character.toUpperCase() && next && next !== next.toLowerCase() ? out.toUpperCase() : out;
    })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function nameWords(name: string | undefined): string[] {
  if (!name) return [];
  return transliterate(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** An id is never a bare number: `123` or `✓✓✓` give no id words. */
export function hasIdWords(name: string | undefined): boolean {
  return nameWords(name).some((word) => /[A-Za-z]/.test(word));
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A join and / or number tells a slug apart from its neighbours, so it survives a cut. */
const KEPT_TAIL = /(?:(?<=[a-z0-9])Join|_[Jj]oin)?(?:(?<=[A-Za-z])\d+|_\d+)?$/;

/**
 * Cuts at the last word boundary that fits, keeping a join or number tail. A cut keeps a letter
 * and never runs a number into the kept one (`1010`). `legacy` cuts as 0.6 did, to recognise
 * the ids it wrote.
 * A filler word between a number and the number tail keeps them apart (`StartAfter2Und2`).
 */
export function cutAt(slug: string, max: number, legacy = false, names = false): string {
  if (slug.length <= max) return slug;
  const tail = keptTail(slug);
  if (tail && max - tail.length >= 8) {
    const head = slug.slice(0, -tail.length);
    const cut = cutWords(head, max - tail.length, legacy, names);
    if (legacy || readsApart(cut, tail)) return `${cut}${tail}`;
    const kept = names ? cutWords(head, max - tail.length) : cut;
    if (readsApart(kept, tail)) return `${kept}${tail}`;
    const inside = trimSeparators(head.slice(0, max - tail.length));
    if (readsApart(inside, tail)) return `${inside}${tail}`;
  }
  return cutWords(slug, max, legacy, names);
}

export function cutName(slug: string, max: number): string {
  return cutAt(slug, max, false, true);
}

/** The head has a letter and does not run into a number tail as one number (`Stufe2` + `3`). */
export function readsApart(head: string, tail: string): boolean {
  return /[A-Za-z]/.test(head) && !(/\d$/.test(head) && /^\d/.test(tail));
}

const trimSeparators = (slug: string): string => slug.replace(/[_.-]+$/, '');

function cutWords(slug: string, max: number, legacy = false, names = false): string {
  if (slug.length <= max) return slug;
  if (legacy) return legacyCutWords(slug, max);
  const words: string[] = [];
  let length = 0;
  for (const word of idWords(slug)) {
    if (length + word.length > max) break;
    words.push(word);
    length += word.length;
  }
  if (names) while (words.length > 1 && isFiller(words[words.length - 1]!) && words.slice(0, -1).some((word) => /[A-Za-z]/.test(word))) words.pop();
  const out = words.join('');
  if (out && /[A-Za-z]/.test(out)) return trimSeparators(out);
  return trimSeparators(withLetter(slug, slug.slice(0, Math.max(max, 0)), (rest) => cutWords(rest, max, false, names)));
}

/** A cut that keeps no letter (a leading number) starts at the first word with a letter instead. */
export function withLetter(slug: string, cut: string, again: (rest: string) => string): string {
  if (/[A-Za-z]/.test(cut)) return cut;
  const words = idWords(slug);
  const at = words.findIndex((word) => /[A-Za-z]/.test(word));
  return at > 0 ? again(words.slice(at).join('').replace(/^[_.-]+/, '')) : cut;
}

/** cutWords as 0.6 cut: also at the boundary right after a separator. */
function legacyCutWords(slug: string, max: number): string {
  let best = 0;
  for (let index = 1; index <= max; index++) {
    const prev = slug.charAt(index - 1);
    const character = slug.charAt(index);
    const boundary = /[_.-]/.test(character) || (/[A-Z]/.test(character) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(character) && /[A-Za-z]/.test(prev)) || /[_.-]/.test(prev);
    if (boundary) best = index;
  }
  return trimSeparators(best > 0 ? slug.slice(0, best) : slug.slice(0, max));
}

/** Each word keeps the separator before it, so joined they give the slug again. */
export function idWords(slug: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let index = 1; index < slug.length; index++) {
    const prev = slug.charAt(index - 1);
    const character = slug.charAt(index);
    if (/[_.-]/.test(prev)) continue;
    const boundary = /[_.-]/.test(character) || (/[A-Z]/.test(character) && /[a-z0-9]/.test(prev)) || (/[0-9]/.test(character) && /[A-Za-z]/.test(prev));
    if (boundary) {
      out.push(slug.slice(start, index));
      start = index;
    }
  }
  if (slug) out.push(slug.slice(start));
  return out;
}

export function keptTail(slug: string): string {
  const tail = KEPT_TAIL.exec(slug)?.[0] ?? '';
  return tail.length < slug.length ? tail : '';
}

function cut(slug: string, legacy = false): string {
  return legacy ? cutAt(slug, MAX_SLUG, true) : cutName(slug, MAX_SLUG);
}

export function slugify(name: string | undefined, legacy = false): string {
  return cut(nameWords(name).map(cap).join(''), legacy);
}

export function camelSlug(name: string | undefined, legacy = false): string {
  const words = nameWords(name);
  if (!words.length) return '';
  const [first, ...rest] = words;
  const head = /^[A-Z0-9]+$/.test(first!) ? first!.toLowerCase() : first!.charAt(0).toLowerCase() + first!.slice(1);
  return cut(head + rest.map(cap).join(''), legacy);
}

export function snakeSlug(name: string | undefined, legacy = false): string {
  return cut(
    nameWords(name)
      .map((word) => word.toLowerCase())
      .join('_'),
    legacy,
  );
}

export function pascalSnakeSlug(name: string | undefined, legacy = false): string {
  return cut(nameWords(name).map(cap).join('_'), legacy);
}

/** `step1No2`, never `step12`, which reads as the id of Step 12. */
export const SUFFIX_WORD = 'No';

export function withSuffix(base: string, sep: string, suffixNumber: number, cut: (max: number) => string = (max) => cutAt(base, max)): string {
  const fit = (suffix: string): string => (base.length + suffix.length <= MAX_ID ? base : cut(MAX_ID - suffix.length));
  if (sep !== '') return `${fit(`${sep}${suffixNumber}`)}${sep}${suffixNumber}`;
  const glued = fit(`${suffixNumber}`);
  if (!/\d$/.test(glued)) return `${glued}${suffixNumber}`;
  const worded = fit(`${SUFFIX_WORD}${suffixNumber}`);
  return /\d$/.test(worded) ? `${worded}${SUFFIX_WORD}${suffixNumber}` : `${worded}${suffixNumber}`;
}

/** `either`: a flow's id, whose separator the reader does not know. */
export function isSuffix(base: string, rest: string, sep: string | 'either'): boolean {
  const word = /\d$/.test(base) ? `(?:${SUFFIX_WORD})?` : '';
  if (sep === 'either') return new RegExp(`^(?:_|${word})\\d+$`).test(rest);
  return new RegExp(sep === '' ? `^${word}\\d+$` : `^${sep}\\d+$`).test(rest);
}

/** BPMN ids must be XML NCNames. */
export function isValidId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
}

/** A valid id start that leaves 8 of the 64 characters for the body. */
export function isUsablePrefix(prefix: unknown): prefix is string {
  return typeof prefix === 'string' && prefix.length <= MAX_ID - 8 && isValidId(`${prefix}a`);
}

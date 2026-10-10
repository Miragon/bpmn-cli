/**
 * Id building blocks: name words, slugs, the id registry.
 *
 * Which id a new element gets is decided by the file's id style
 * (src/idstyle.ts): new ids follow the conventions the file already uses,
 * and a file without a convention gets the bpmn-cli default
 * (`Activity_CheckInvoice`, `Flow_CheckInvoiceToBookInvoice`).
 *
 * Names become ASCII words: German umlauts are transliterated (ä -> ae,
 * ö -> oe, ü -> ue, ß -> ss; Ä -> Ae, or AE inside an upper-case word),
 * other accents are dropped (é -> e), everything that is not a letter or
 * digit separates words.
 */

const MAX_SLUG = 40;

const GERMAN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ẞ: 'SS' };

/** The ASCII transliteration of a name (German umlauts as ae / oe / ue / ss, other accents dropped). */
export function transliterate(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[äöüßÄÖÜẞ]/g, (c, at: number, all: string) => {
      const out = GERMAN[c]!;
      // Ä in an upper-case word (ÄNDERUNG) -> AE
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

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** Cuts a slug to MAX_SLUG characters (and a trailing separator off). */
function cut(slug: string): string {
  return slug.length > MAX_SLUG ? slug.slice(0, MAX_SLUG).replace(/_+$/, '') : slug;
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

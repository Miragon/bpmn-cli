import { IdCut } from './IdCut.js';

export class IdSlug {
  static readonly MAX_SLUG = 40;
  private static readonly SPELLED: Record<string, string> = {
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
  private static readonly SPELLED_RE = new RegExp(`[${Object.keys(IdSlug.SPELLED).join('')}]`, 'g');

  static transliterate(name: string): string {
    return name
      .normalize('NFC')
      .replace(IdSlug.SPELLED_RE, (character, at: number, all: string) => {
        const out = IdSlug.SPELLED[character]!;
        const next = all.charAt(at + 1);
        return out.length === 2 && character === character.toUpperCase() && next && next !== next.toLowerCase() ? out.toUpperCase() : out;
      })
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  static nameWords(name: string | undefined): string[] {
    if (!name) {
      return [];
    }
    return IdSlug.transliterate(name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  static hasIdWords(name: string | undefined): boolean {
    return IdSlug.nameWords(name).some((word) => /[A-Za-z]/.test(word));
  }

  static slugify(name: string | undefined): string {
    return IdSlug.cut(IdSlug.nameWords(name).map(IdSlug.cap).join(''));
  }

  static camelSlug(name: string | undefined): string {
    const words = IdSlug.nameWords(name);
    if (!words.length) {
      return '';
    }
    const [first, ...rest] = words;
    const head = /^[A-Z0-9]+$/.test(first!) ? first!.toLowerCase() : first!.charAt(0).toLowerCase() + first!.slice(1);
    return IdSlug.cut(head + rest.map(IdSlug.cap).join(''));
  }

  static snakeSlug(name: string | undefined): string {
    return IdSlug.cut(
      IdSlug.nameWords(name)
        .map((word) => word.toLowerCase())
        .join('_'),
    );
  }

  static kebabSlug(name: string | undefined): string {
    return IdSlug.cut(
      IdSlug.nameWords(name)
        .map((word) => word.toLowerCase())
        .join('-'),
    );
  }

  static isValidId(id: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
  }

  static isUsablePrefix(prefix: unknown): prefix is string {
    return typeof prefix === 'string' && prefix.length <= IdCut.MAX_ID - 8 && IdSlug.isValidId(`${prefix}a`);
  }

  private static cap(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  private static cut(slug: string): string {
    return IdCut.cutName(slug, IdSlug.MAX_SLUG);
  }
}

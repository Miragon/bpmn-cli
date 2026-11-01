import type { Body, IdConventions, IdState } from './IdDefaults.js';
import { IdSlug } from './IdSlug.js';

export class DeclaredConventions {
  private static readonly BODY_OF_CASE: Readonly<Record<string, Body>> = { camelCase: 'camel', PascalCase: 'pascal', snake_case: 'snake', 'kebab-case': 'kebab' };
  private static readonly CASE_BODY: Readonly<Record<Body, RegExp>> = { camel: /^[a-z][A-Za-z0-9]*$/, pascal: /^[A-Z][A-Za-z0-9]*$/, snake: /^[a-z0-9]+(_[a-z0-9]+)*$/, kebab: /^[a-z0-9]+(-[a-z0-9]+)*$/ };

  private constructor(
    readonly prefixes: Record<string, string>,
    readonly qualifier: 'off' | 'optional' | 'required',
    readonly bodyCase: Body | undefined,
    private readonly ignored: Set<string>,
  ) {}

  static of(conventions: IdConventions): DeclaredConventions {
    const prefixes: Record<string, string> = {};
    for (const [key, prefix] of Object.entries(conventions.prefixes)) {
      if (IdSlug.isUsablePrefix(prefix)) {
        prefixes[key] = prefix;
      }
    }
    const body = conventions.case ? DeclaredConventions.BODY_OF_CASE[conventions.case] : undefined;
    return new DeclaredConventions(prefixes, conventions.qualifier ?? 'optional', body, new Set(conventions.ignored));
  }

  headFor(type: string, trigger: string | undefined): string | undefined {
    const plain = this.prefixes[type];
    if (plain === undefined) {
      return undefined;
    }
    if (this.qualifier === 'required' && trigger && trigger !== 'none') {
      return this.prefixes[`${type}:${trigger}`] ?? plain;
    }
    return plain;
  }

  headsOf({ type, trigger }: IdState): string[] {
    const plain = this.prefixes[type];
    if (plain === undefined) {
      return [];
    }
    const key = `${type}:${trigger}`;
    const qualified = trigger && trigger !== 'none' && this.qualifier !== 'off' ? this.prefixes[key] : undefined;
    if (!qualified) {
      return this.qualifier === 'required' && this.ignored.has(key) ? [] : [plain];
    }
    return this.qualifier === 'required' ? [qualified] : [plain, qualified];
  }

  acceptsId(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    return !heads.length || heads.some((head) => id.startsWith(head));
  }

  headOf(id: string, state: IdState): string | undefined {
    return this.headsOf(state)
      .filter((head) => id.startsWith(head))
      .sort((first, second) => second.length - first.length)[0];
  }

  inDeclaredCase(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    if (!heads.length) {
      return true;
    }
    const head = this.headOf(id, state);
    if (head === undefined) {
      return false;
    }
    return !this.bodyCase || DeclaredConventions.CASE_BODY[this.bodyCase].test(id.slice(head.length));
  }

  get upperFirst(): boolean {
    const heads = new Set(Object.values(this.prefixes));
    let upper = 0;
    for (const head of heads) {
      if (/^[A-Z]/.test(head)) {
        upper++;
      }
    }
    return upper * 2 > heads.size;
  }
}

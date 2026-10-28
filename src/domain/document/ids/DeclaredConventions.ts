import { isUsablePrefix } from '../utils/slug.js';
import type { IdConventions } from './IdConventions.js';
import type { Body, IdState } from './IdStyle.js';

const BODY_OF_CASE: Record<string, Body> = { camelCase: 'camel', PascalCase: 'pascal', snake_case: 'snake', 'kebab-case': 'kebab' };

/** The bodies element-id-naming accepts after the prefix under a declared case. */
const CASE_BODY: Record<Body, RegExp> = { camel: /^[a-z][A-Za-z0-9]*$/, pascal: /^[A-Z][A-Za-z0-9]*$/, snake: /^[a-z0-9]+(_[a-z0-9]+)*$/, kebab: /^[a-z0-9]+(-[a-z0-9]+)*$/ };

/**
 * The declared id conventions as the style uses them: the usable prefixes and the body case,
 * checked the way element-id-naming checks them.
 */
export class DeclaredConventions {
  private constructor(
    readonly prefixes: Record<string, string>,
    readonly qualifier: 'off' | 'optional' | 'required',
    /** undefined: `any`, the body is not checked */
    readonly bodyCase: Body | undefined,
    /** event triggers (`bpmn:EndEvent:escalation`) whose required qualified prefix new ids cannot have */
    private readonly ignored: Set<string>,
  ) {}

  static of(conventions: IdConventions): DeclaredConventions {
    const prefixes: Record<string, string> = {};
    for (const [key, prefix] of Object.entries(conventions.prefixes)) if (isUsablePrefix(prefix)) prefixes[key] = prefix;
    const body = conventions.case ? BODY_OF_CASE[conventions.case] : undefined;
    return new DeclaredConventions(prefixes, conventions.qualifier ?? 'optional', body, new Set(conventions.ignored));
  }

  /** Under `required` an event with a trigger takes the qualified prefix (timerStartEvent_) where it has one. */
  headFor(type: string, trigger: string | undefined): string | undefined {
    const plain = this.prefixes[type];
    if (plain === undefined) return undefined;
    if (this.qualifier === 'required' && trigger && trigger !== 'none') return this.prefixes[`${type}:${trigger}`] ?? plain;
    return plain;
  }

  /**
   * The plain and the qualified prefix, as element-id-naming accepts them
   * (`required`: only the qualified one; `off`: only the plain one).
   */
  headsOf({ type, trigger }: IdState): string[] {
    const plain = this.prefixes[type];
    if (plain === undefined) return [];
    const key = `${type}:${trigger}`;
    const qualified = trigger && trigger !== 'none' && this.qualifier !== 'off' ? this.prefixes[key] : undefined;
    if (!qualified) return this.qualifier === 'required' && this.ignored.has(key) ? [] : [plain];
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

  /** acceptsId, and the body is in the declared case too. */
  inDeclaredCase(id: string, state: IdState): boolean {
    const heads = this.headsOf(state);
    if (!heads.length) return true;
    const head = this.headOf(id, state);
    if (head === undefined) return false;
    return !this.bodyCase || CASE_BODY[this.bodyCase].test(id.slice(head.length));
  }

  /** Most declared prefixes begin upper case (Activity_), so bpmn-cli's own ones do too (Message_). */
  get upperFirst(): boolean {
    const heads = new Set(Object.values(this.prefixes));
    let upper = 0;
    for (const head of heads) if (/^[A-Z]/.test(head)) upper++;
    return upper * 2 > heads.size;
  }
}

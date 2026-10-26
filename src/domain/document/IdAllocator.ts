import { isSuffix, withSuffix } from './utils/slug.js';
import type { IdStyle } from './ids/IdStyle.js';
import type { IdRequest } from './utils/requests.js';
import type { ChangeSet } from './ChangeSet.js';
import type { Doc } from './Doc.js';

/**
 * The ids one edit gives out, and what it recorded about them: the id each generated one wanted,
 * the ones that took a collision suffix, the ones under a declared prefix.
 */
export class IdAllocator {
  private suffixedIds: Array<{ id: string; base: string }> = [];
  /** generated id -> the id it wanted; nobody's API yet, so a later op may still rename it */
  private readonly generated = new Map<string, string>();
  /** ids under a declared prefix that the file's own style would give otherwise */
  private readonly declared: string[] = [];

  constructor(
    private readonly doc: Doc,
    private readonly styleOf: () => IdStyle,
  ) {}

  begin(): void {
    this.generated.clear();
  }

  /**
   * Claims a new id; `base` is the id the request wanted before a collision suffix. An id under a
   * declared prefix that the file's own style would give otherwise goes on the `conventions:` line.
   */
  allocate(req: IdRequest): { id: string; base: string } {
    const style = this.styleOf();
    const ids = this.doc.ids;
    const out = style.next(req, ids);
    if (style.ownStyleDiffers && style.explain(req).source === 'lint' && out.base !== style.learnedOnly().next(req, ids).base) this.declared.push(out.id);
    ids.claim(out.id);
    this.generated.set(out.id, out.base);
    if (out.id !== out.base) this.suffixedIds.push(out);
    return out;
  }

  explicitOr(id: string | undefined, req: IdRequest): string {
    if (id) {
      this.doc.claimId(id);
      return id;
    }
    return this.allocate(req).id;
  }

  /** Claims nothing. */
  baseOf(req: IdRequest): string {
    return this.styleOf().derivedBase(req);
  }

  /** `base` with the first free collision suffix after `sep`; claims and records nothing. */
  suffixed(base: string, sep: string, taken: (id: string) => boolean = (id) => this.doc.has(id) || this.doc.ids.has(id), cut?: (max: number) => string): string {
    let id = base;
    for (let suffix = 2; taken(id); suffix++) id = withSuffix(base, sep, suffix, cut);
    return id;
  }

  /**
   * A free id from `base` for a generated id `old` that a retype left with a stale prefix.
   * Claims nothing: the rename does.
   */
  regenerated(old: string, base: string, sep: string): string {
    const id = this.suffixed(base, sep);
    if (id !== base) this.suffixedIds.push({ id, base });
    if (this.declared.includes(old)) this.declared.push(id);
    return id;
  }

  /** Undefined unless the running batch generated `id` and no explicit claim took it since. */
  generatedBase(id: string): string | undefined {
    return this.generated.get(id);
  }

  generatedFrom(id: string, req: IdRequest): boolean {
    const base = this.generated.get(id);
    return base !== undefined && base === this.baseOf(req);
  }

  /** Whether `req` gives `id` in the style, with or without a collision suffix. */
  isDerived(id: string, req: IdRequest): boolean {
    return this.styleOf()
      .derivedBases(req, id)
      .some((base) => id === base || (id.startsWith(base) && isSuffix(base, id.slice(base.length), 'either')));
  }

  markGenerated(id: string, base: string): void {
    this.generated.set(id, base);
  }

  forgetGenerated(id: string): void {
    this.generated.delete(id);
  }

  recordDeclared(id: string): void {
    if (this.styleOf().ownStyleDiffers) this.declared.push(id);
  }

  get declaredIds(): readonly string[] {
    return this.declared;
  }

  reportSuffixed(cs: ChangeSet): void {
    const suffixed = this.suffixedIds;
    this.suffixedIds = [];
    for (const { id, base } of suffixed) {
      if (cs.warnings.some((warning) => warning.code === 'W_ID_SUFFIXED' && warning.element === id)) continue;
      cs.warn({
        code: 'W_ID_SUFFIXED',
        message: `Id ${base} is already taken; using ${id}`,
        element: id,
        hint: 'Pass an explicit id to choose it yourself (--id, "id"; --flow-id / "flowId" for the flow into a new node, "joinId" for a join), or give the element a distinct name.',
      });
    }
  }
}

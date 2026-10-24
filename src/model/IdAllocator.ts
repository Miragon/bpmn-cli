/**
 * The ids one edit gives out (EditContext.allocator): a new id in the edit's
 * id style, an explicit id instead, a free id with a collision suffix, and
 * what the edit recorded about them: the id each generated one wanted
 * (nobody's API yet), the ones that took a suffix (W_ID_SUFFIXED), the ones
 * under a declared prefix the file's own style would not give (the result's
 * `conventions:` line).
 */
import { isSuffix, withSuffix } from '../ids/utils/slug.js';
import type { IdStyle } from '../ids/IdStyle.js';
import type { IdRequest } from '../ids/utils/requests.js';
import type { ChangeSet } from './ChangeSet.js';
import type { Doc } from './Doc.js';

export class IdAllocator {
  /** generated ids that took a collision suffix since the last reportSuffixed() (W_ID_SUFFIXED) */
  private suffixedIds: Array<{ id: string; base: string }> = [];
  /** the ids allocate generated since the batch or the op on its own began -> the id each wanted: nobody's API yet */
  private readonly generated = new Map<string, string>();
  /** generated ids under a declared prefix that the file's own style would give otherwise */
  private readonly declared: string[] = [];

  constructor(
    private readonly doc: Doc,
    private readonly styleOf: () => IdStyle,
  ) {}

  /** A batch or an op on its own begins: the ids generated before are no longer its own. */
  begin(): void {
    this.generated.clear();
  }

  /**
   * A new id in the style for a kindRequest / typeRequest /
   * connectionRequest / flowRequest; claims it. `base` is the id the
   * request wanted: when it was taken the id carries a suffix, which is
   * recorded for W_ID_SUFFIXED (reportSuffixed). An id under a prefix the
   * declared conventions name for the request (IdStyle.explain: `lint`;
   * not one they only shaped, nor a message flow that borrows the sequence
   * flows' prefix) that the file's own style would give otherwise is
   * recorded for the result's `conventions:` line (declaredIds), in a file
   * that has a style of its own there (IdStyle.ownStyleDiffers: ids the
   * conventions check that do not follow them; not a new file, nor one
   * whose checked ids all follow them).
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

  /** `id` when the op names one (validated and claimed, Doc.claimId), else a new one for `req`. */
  explicitOr(id: string | undefined, req: IdRequest): string {
    if (id) {
      this.doc.claimId(id);
      return id;
    }
    return this.allocate(req).id;
  }

  /** The id a request wants, before a collision suffix (IdStyle.derivedBase); claims nothing. */
  baseOf(req: IdRequest): string {
    return this.styleOf().derivedBase(req);
  }

  /**
   * `base`, or where `taken` says it is taken (by default: by the document)
   * `base` with the first free collision suffix after `sep` (withSuffix: cut
   * by `cut`, else to stay within MAX_ID). Claims and records nothing.
   */
  suffixed(base: string, sep: string, taken: (id: string) => boolean = (id) => this.doc.has(id) || this.doc.ids.has(id), cut?: (max: number) => string): string {
    let id = base;
    for (let n = 2; taken(id); n++) id = withSuffix(base, sep, n, cut);
    return id;
  }

  /**
   * A free id from `base` for an element whose generated id `old` a retype
   * or a trigger change gave a stale prefix (IdRenamer.recordState): a
   * taken one gets a collision suffix after `sep` (W_ID_SUFFIXED); on the
   * result's `conventions:` line where `old` was. Claims nothing (the rename
   * does; markGenerated after it).
   */
  regenerated(old: string, base: string, sep: string): string {
    const id = this.suffixed(base, sep);
    if (id !== base) this.suffixedIds.push({ id, base });
    if (this.declared.includes(old)) this.declared.push(id);
    return id;
  }

  /**
   * The id `id` wanted (before a collision suffix) where allocate (or
   * markGenerated) generated it since the batch or the op on its own began
   * and no explicit claim took it since (Doc.claimId): nobody's API yet
   * (IdRenamer.recordState renames it where a retype leaves its prefix
   * stale); undefined for every other id.
   */
  generatedBase(id: string): string | undefined {
    return this.generated.get(id);
  }

  /** Whether the edit generated `id` (generatedBase) as the id `req` wants now (a flow from its ends as they are). */
  generatedFrom(id: string, req: IdRequest): boolean {
    const base = this.generated.get(id);
    return base !== undefined && base === this.baseOf(req);
  }

  /**
   * Whether `id` is one of the ids `req` gives in the style (IdStyle.derivedBases,
   * given `id`: only the styles it can be of), or such an id with a collision suffix.
   */
  isDerived(id: string, req: IdRequest): boolean {
    return this.styleOf()
      .derivedBases(req, id)
      .some((base) => id === base || (id.startsWith(base) && isSuffix(base, id.slice(base.length), 'either')));
  }

  /** Records `id` as generated from `base` outside allocate (a split's join, an id recordState gave): generatedBase. */
  markGenerated(id: string, base: string): void {
    this.generated.set(id, base);
  }

  /** An explicit claim took `id` (Doc.claimId): the caller's, so no longer generated (generatedBase). */
  forgetGenerated(id: string): void {
    this.generated.delete(id);
  }

  /** Records an id under a declared prefix that the file's own style would give otherwise, outside allocate (a split's join), where the file has a style of its own there (IdStyle.ownStyleDiffers). */
  recordDeclared(id: string): void {
    if (this.styleOf().ownStyleDiffers) this.declared.push(id);
  }

  /** The ids under a declared prefix recorded so far (allocate; the edit transaction reports those still in the document). */
  get declaredIds(): readonly string[] {
    return this.declared;
  }

  /** W_ID_SUFFIXED on `cs` for every generated id that took a collision suffix since the last call (the id it wanted was taken). */
  reportSuffixed(cs: ChangeSet): void {
    const suffixed = this.suffixedIds;
    this.suffixedIds = [];
    for (const { id, base } of suffixed) {
      if (cs.warnings.some((w) => w.code === 'W_ID_SUFFIXED' && w.element === id)) continue;
      cs.warn({
        code: 'W_ID_SUFFIXED',
        message: `Id ${base} is already taken; using ${id}`,
        element: id,
        hint: 'Pass an explicit id to choose it yourself (--id, "id"; --flow-id / "flowId" for the flow into a new node, "joinId" for a join), or give the element a distinct name.',
      });
    }
  }
}

import type { BpmnTree } from '../document/BpmnTree.js';
import type { ChangeSet } from '../document/ChangeSet.js';
import { BpmnError } from '../errors/BpmnError.js';
import { IdCut } from './IdCut.js';
import type { IdRegistry } from './IdRegistry.js';
import type { IdRequest } from './IdRequests.js';
import { IdSlug } from './IdSlug.js';
import type { IdStyle } from './IdStyle.js';

export class IdAllocator {
  private suffixedIds: Array<{ id: string; base: string }> = [];
  private readonly generated = new Map<string, string>();

  constructor(
    private readonly tree: BpmnTree,
    readonly registry: IdRegistry,
    private readonly styleOf: () => IdStyle,
  ) {}

  begin(): void {
    this.generated.clear();
  }

  allocate(req: IdRequest): { id: string; base: string } {
    const ids = this.registry;
    const out = this.styleOf().next(req, ids);
    ids.claim(out.id);
    this.generated.set(out.id, out.base);
    if (out.id !== out.base) {
      this.suffixedIds.push(out);
    }
    return out;
  }

  explicitOr(id: string | undefined, req: IdRequest): string {
    if (id) {
      this.claim(id);
      return id;
    }
    return this.allocate(req).id;
  }

  claim(id: string): void {
    if (!IdSlug.isValidId(id)) {
      throw BpmnError.model('E_INVALID_ID', `"${id}" is not a valid id: must match [A-Za-z_][A-Za-z0-9_.-]*`, { element: id });
    }
    if (this.tree.has(id) || this.registry.has(id)) {
      throw BpmnError.model('E_DUPLICATE_ID', `An element with id "${id}" already exists`, { element: id, hint: 'Choose another --id or omit it.' });
    }
    this.registry.claim(id);
    this.generated.delete(id);
  }

  baseOf(req: IdRequest): string {
    return this.styleOf().derivedBase(req);
  }

  suffixed(base: string, sep: string, taken: (id: string) => boolean = (id) => this.tree.has(id) || this.registry.has(id), cut?: (max: number) => string): string {
    let id = base;
    for (let suffix = 2; taken(id); suffix++) {
      id = IdCut.withSuffix(base, sep, suffix, cut);
    }
    return id;
  }

  regenerated(base: string, sep: string): string {
    const id = this.suffixed(base, sep);
    if (id !== base) {
      this.suffixedIds.push({ id, base });
    }
    return id;
  }

  generatedBase(id: string): string | undefined {
    return this.generated.get(id);
  }

  generatedFrom(id: string, req: IdRequest): boolean {
    const base = this.generated.get(id);
    return base !== undefined && base === this.baseOf(req);
  }

  isDerived(id: string, req: IdRequest): boolean {
    return this.styleOf()
      .derivedBases(req)
      .some((base) => id === base || (id.startsWith(base) && IdCut.isSuffix(base, id.slice(base.length), 'either')));
  }

  markGenerated(id: string, base: string): void {
    this.generated.set(id, base);
  }

  reportSuffixed(cs: ChangeSet): void {
    const suffixed = this.suffixedIds;
    this.suffixedIds = [];
    for (const { id, base } of suffixed) {
      if (cs.warnings.some((warning) => warning.code === 'W_ID_SUFFIXED' && warning.element === id)) {
        continue;
      }
      cs.warn({
        code: 'W_ID_SUFFIXED',
        message: `Id ${base} is already taken; using ${id}`,
        element: id,
        hint: 'Pass an explicit id to choose it yourself (--id, "id"; --flow-id / "flowId" for the flow into a new node, "joinId" for a join), or give the element a distinct name.',
      });
    }
  }
}

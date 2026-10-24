/**
 * The sub-processes ops asked to lay out expanded or collapsed (`add
 * --collapsed`, `set <id> expanded=`). The expansion lives in DI, which
 * only the layout writes, so the requests stay with the document (Doc.layoutRequests)
 * until a layout reads them (pipeline/DiagramUpdate.ts; with --no-layout it
 * records them in the existing DI).
 */
export class LayoutRequests {
  /** sub-processes `add --collapsed` asked to lay out collapsed */
  private readonly collapsed = new Set<string>();
  /** sub-processes `set <id> expanded=` asked to lay out expanded (true) or collapsed (false) */
  private readonly expansions = new Map<string, boolean>();

  /** Records that sub-process `id` must be laid out collapsed (`add --collapsed`). */
  collapse(id: string): void {
    this.collapsed.add(id);
  }

  /** Records that a sub-process should be laid out expanded (true) or collapsed (false) (`set <id> expanded=`). */
  expand(id: string, expanded: boolean): void {
    this.expansions.set(id, expanded);
  }

  /** The expansion `set <id> expanded=` requested for sub-process `id`, undefined without one. */
  requested(id: string): boolean | undefined {
    return this.expansions.get(id);
  }

  /**
   * The sub-processes to lay out expanded and collapsed: `opts` (the layout
   * command's --expand / --collapse), then the requests of the ops; an
   * explicit expand wins over a collapse request and vice versa (last
   * writer: the options).
   */
  expansion(opts: { expand?: string[]; collapse?: string[] } = {}): { expand: string[]; collapse: string[] } {
    const expand = new Set<string>(opts.expand ?? []);
    const collapse = new Set<string>(opts.collapse ?? []);
    for (const id of this.collapsed) collapse.add(id);
    for (const [id, expanded] of this.expansions) (expanded ? expand : collapse).add(id);
    for (const id of opts.expand ?? []) collapse.delete(id);
    for (const id of opts.collapse ?? []) expand.delete(id);
    return { expand: [...expand], collapse: [...collapse] };
  }
}

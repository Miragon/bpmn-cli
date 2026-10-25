/**
 * The sub-processes ops asked to lay out expanded or collapsed. The expansion lives in DI, which
 * only the layout writes, so the requests wait on the document until a layout reads them.
 */
export class LayoutRequests {
  private readonly collapsed = new Set<string>();
  private readonly expansions = new Map<string, boolean>();

  collapse(id: string): void {
    this.collapsed.add(id);
  }

  expand(id: string, expanded: boolean): void {
    this.expansions.set(id, expanded);
  }

  requested(id: string): boolean | undefined {
    return this.expansions.get(id);
  }

  /** The layout command's --expand / --collapse win over the ops' requests. */
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

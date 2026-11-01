export class LayoutRequests {
  private readonly expansions = new Map<string, boolean>();

  expand(id: string, expanded: boolean): void {
    this.expansions.set(id, expanded);
  }

  merge(other: LayoutRequests): void {
    for (const [id, expanded] of other.expansions) {
      this.expansions.set(id, expanded);
    }
  }

  requested(id: string): boolean | undefined {
    return this.expansions.get(id);
  }

  expansion(): { expand: string[]; collapse: string[] } {
    const requests = [...this.expansions];
    return { expand: requests.filter(([, expanded]) => expanded).map(([id]) => id), collapse: requests.filter(([, expanded]) => !expanded).map(([id]) => id) };
  }
}

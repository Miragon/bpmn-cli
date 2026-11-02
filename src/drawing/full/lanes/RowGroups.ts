import type { GNode } from '../scopes/GNode.js';

export class RowGroups {
  constructor(
    private readonly nodes: readonly GNode[],
    private readonly groups: ReadonlyMap<string, readonly string[]> | undefined,
  ) {}

  private static unit(node: GNode): GNode {
    return node.host ?? node;
  }

  private static neighbours(member: GNode): GNode[] {
    const next = [...member.out.map((edge) => edge.target), ...member.in.map((edge) => edge.source)];
    for (const event of member.boundary) {
      next.push(...event.out.map((edge) => edge.target), ...(event.compensationHandler ? [event.compensationHandler] : []));
    }
    if (member.compensatedBy) {
      next.push(member.compensatedBy);
    }
    return next.map(RowGroups.unit);
  }

  private static compare(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) {
        return left[index]! - right[index]!;
      }
    }
    return left.length - right.length;
  }

  ordered(roots: readonly GNode[]): GNode[] {
    if (!this.groups?.size || roots.length < 2) {
      return [...roots];
    }
    const pathOf = this.partGroups(this.groups);
    const first = new Map<string, number>();
    const keys = new Map<GNode, number[]>();
    roots.forEach((node, index) => {
      let path = '';
      const key: number[] = [];
      for (const group of pathOf.get(RowGroups.unit(node)) ?? []) {
        path += `/${group}`;
        if (!first.has(path)) {
          first.set(path, index);
        }
        key.push(first.get(path)!);
      }
      keys.set(node, [...key, index]);
    });
    return [...roots].sort((left, right) => RowGroups.compare(keys.get(left)!, keys.get(right)!));
  }

  private connectedParts(): Map<GNode, GNode[]> {
    const partOf = new Map<GNode, GNode[]>();
    for (const node of this.nodes) {
      if (!partOf.has(node)) {
        const part: GNode[] = [node];
        partOf.set(node, part);
        for (let index = 0; index < part.length; index++) {
          for (const neighbour of RowGroups.neighbours(part[index]!)) {
            if (!partOf.has(neighbour)) {
              partOf.set(neighbour, part);
              part.push(neighbour);
            }
          }
        }
      }
    }
    return partOf;
  }

  private partGroups(groups: ReadonlyMap<string, readonly string[]>): Map<GNode, readonly string[]> {
    const partOf = this.connectedParts();
    const paths = new Map<GNode, readonly string[]>();
    const found = new Set<GNode[]>();
    for (const node of this.nodes) {
      const part = partOf.get(node)!;
      const path = found.has(part) ? undefined : [node, ...node.boundary].map((member) => groups.get(member.id)).find((groupPath) => groupPath?.length);
      if (path) {
        found.add(part);
        for (const member of part) {
          paths.set(member, path);
        }
      }
    }
    return paths;
  }
}

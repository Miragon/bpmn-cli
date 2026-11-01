import type { GEdge, GNode, ScopeLayout } from './GNode.js';

interface ClosingEdge {
  edge: GEdge;
  index: number;
  targetDepth: number;
  sourceDepth: number;
}

export class BackEdges {
  private readonly roots: GNode[];

  constructor(private readonly layout: ScopeLayout) {
    const { nodes } = layout;
    this.roots = [...nodes.filter((node) => node.kind === 'start'), ...nodes.filter((node) => node.kind !== 'start' && node.in.length === 0)];
  }

  private static forwardOut(node: GNode): GEdge[] {
    return node.outgoing.filter((edge) => !edge.back);
  }

  private static reaches(from: GNode, to: GNode): boolean {
    const seen = new Set<GNode>([from]);
    const stack = [from];
    while (stack.length) {
      const node = stack.pop()!;
      if (node === to) {
        return true;
      }
      for (const { target } of BackEdges.forwardOut(node)) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
    return false;
  }

  private static closesLater(candidate: ClosingEdge, best: ClosingEdge | undefined): boolean {
    if (!best || candidate.targetDepth !== best.targetDepth) {
      return !best || candidate.targetDepth < best.targetDepth;
    }
    return candidate.sourceDepth > best.sourceDepth || (candidate.sourceDepth === best.sourceDepth && candidate.index > best.index);
  }

  mark(): void {
    const { edges } = this.layout;
    for (let guard = 0; guard <= edges.length && this.hasCycle(); guard++) {
      const closing = this.shallowestClosing(this.depths());
      if (!closing) {
        break;
      }
      closing.edge.back = true;
    }
  }

  private depths(): Map<GNode, number> {
    const depth = new Map<GNode, number>();
    for (const node of [...this.roots, ...this.layout.nodes]) {
      this.walkFrom(node, depth);
    }
    return depth;
  }

  private walkFrom(root: GNode, depth: Map<GNode, number>): void {
    if (depth.has(root)) {
      return;
    }
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const node = queue.shift()!;
      for (const { target } of BackEdges.forwardOut(node)) {
        if (!depth.has(target)) {
          depth.set(target, depth.get(node)! + 1);
          queue.push(target);
        }
      }
    }
  }

  private hasCycle(): boolean {
    const state = new Map<GNode, 'open' | 'done'>();
    const visit = (node: GNode): boolean => {
      state.set(node, 'open');
      for (const { target } of BackEdges.forwardOut(node)) {
        const targetState = state.get(target);
        if (targetState === 'open' || (targetState === undefined && visit(target))) {
          return true;
        }
      }
      state.set(node, 'done');
      return false;
    };
    return this.layout.nodes.some((node) => !state.has(node) && visit(node));
  }

  private shallowestClosing(depth: ReadonlyMap<GNode, number>): ClosingEdge | undefined {
    let best: ClosingEdge | undefined;
    this.layout.edges.forEach((edge, index) => {
      if (edge.back) {
        return;
      }
      const source = edge.source.host ?? edge.source;
      const targetDepth = depth.get(edge.target) ?? 0;
      const sourceDepth = depth.get(source) ?? 0;
      if (targetDepth > sourceDepth || !BackEdges.reaches(edge.target, source)) {
        return;
      }
      const candidate = { edge, index, targetDepth, sourceDepth };
      if (BackEdges.closesLater(candidate, best)) {
        best = candidate;
      }
    });
    return best;
  }
}

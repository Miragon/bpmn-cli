import { elementChildren, idOf, rawOf, type XDocument, type XElement } from './utils/text-reader.js';

/**
 * Pairs the elements of document `a` with their counterparts in `b`, from the roots down:
 * among siblings by unique id (also across a retype), the others by name and order.
 */
export class ElementAligner {
  constructor(
    private readonly a: XDocument,
    private readonly b: XDocument,
    private readonly byText: boolean,
  ) {}

  /** Empty when the roots differ. */
  counterparts(): Map<XElement, XElement> {
    const { a, b } = this;
    const map = new Map<XElement, XElement>();
    if (a.root.uri !== b.root.uri || a.root.local !== b.root.local) return map;
    const stack: Array<[XElement, XElement]> = [[a.root, b.root]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      map.set(x, y);
      stack.push(...this.pairChildren(x, y));
    }
    return map;
  }

  private pairChildren(x: XElement, y: XElement): Array<[XElement, XElement]> {
    const xs = elementChildren(x);
    const ys = elementChildren(y);
    if (!xs.length || !ys.length) return [];
    const xIds = this.uniqueIds(xs);
    const yIds = this.uniqueIds(ys);
    const pairs: Array<[XElement, XElement]> = [];
    const keyed = (el: XElement, ids: Map<string, XElement>): boolean => {
      const id = idOf(el);
      return id !== undefined && ids.get(id) === el;
    };
    for (const c of xs) {
      if (!keyed(c, xIds)) continue;
      const d = yIds.get(idOf(c)!);
      if (d) pairs.push([c, d]);
    }
    const groups = new Map<string, { xs: XElement[]; ys: XElement[] }>();
    const group = (el: XElement): { xs: XElement[]; ys: XElement[] } => {
      const key = `${el.uri} ${el.local}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { xs: [], ys: [] }));
      return g;
    };
    for (const c of xs) if (!keyed(c, xIds) && idOf(c) === undefined) group(c).xs.push(c);
    for (const d of ys) if (!keyed(d, yIds) && idOf(d) === undefined) group(d).ys.push(d);
    for (const g of groups.values()) {
      if (!g.xs.length || !g.ys.length) continue;
      if (this.byText) pairs.push(...this.sequencePairs(g.xs, g.ys));
      else for (let i = 0; i < Math.min(g.xs.length, g.ys.length); i++) pairs.push([g.xs[i]!, g.ys[i]!]);
    }
    return pairs;
  }

  private uniqueIds(els: XElement[]): Map<string, XElement> {
    const seen = new Map<string, XElement | null>();
    for (const el of els) {
      const id = idOf(el);
      if (id === undefined) continue;
      seen.set(id, seen.has(id) ? null : el);
    }
    const out = new Map<string, XElement>();
    for (const [id, el] of seen) if (el) out.set(id, el);
    return out;
  }

  /** Equal texts first (longest common subsequence), then the rest in order. */
  private sequencePairs(xs: XElement[], ys: XElement[]): Array<[XElement, XElement]> {
    const { a, b } = this;
    const m = xs.length;
    const k = ys.length;
    const used = { x: new Set<number>(), y: new Set<number>() };
    const pairs: Array<[XElement, XElement]> = [];
    if (m * k <= 250_000) {
      const tx = xs.map((x) => rawOf(a, x));
      const ty = ys.map((y) => rawOf(b, y));
      const w = k + 1;
      const dp = new Uint32Array((m + 1) * w);
      for (let i = m - 1; i >= 0; i--) {
        for (let j = k - 1; j >= 0; j--) {
          dp[i * w + j] = tx[i] === ty[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
        }
      }
      for (let i = 0, j = 0; i < m && j < k; ) {
        if (tx[i] === ty[j]) {
          pairs.push([xs[i]!, ys[j]!]);
          used.x.add(i);
          used.y.add(j);
          i++;
          j++;
        } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
        else j++;
      }
    }
    const restX = xs.filter((_, i) => !used.x.has(i));
    const restY = ys.filter((_, j) => !used.y.has(j));
    for (let i = 0; i < Math.min(restX.length, restY.length); i++) pairs.push([restX[i]!, restY[i]!]);
    return pairs;
  }
}

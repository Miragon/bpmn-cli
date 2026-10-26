import { elementChildren, idOf, rawOf, type XDocument, type XElement } from '../utils/text-reader.js';

/**
 * Pairs the elements of document `left` with their counterparts in `right`, from the roots down:
 * among siblings by unique id (also across a retype), the others by name and order.
 */
export class ElementAligner {
  constructor(
    private readonly left: XDocument,
    private readonly right: XDocument,
    private readonly byText: boolean,
  ) {}

  /** Empty when the roots differ. */
  counterparts(): Map<XElement, XElement> {
    const { left, right } = this;
    const map = new Map<XElement, XElement>();
    if (left.root.uri !== right.root.uri || left.root.local !== right.root.local) return map;
    const stack: Array<[XElement, XElement]> = [[left.root, right.root]];
    while (stack.length) {
      const [leftEl, rightEl] = stack.pop()!;
      map.set(leftEl, rightEl);
      stack.push(...this.pairChildren(leftEl, rightEl));
    }
    return map;
  }

  private pairChildren(leftEl: XElement, rightEl: XElement): Array<[XElement, XElement]> {
    const xs = elementChildren(leftEl);
    const ys = elementChildren(rightEl);
    if (!xs.length || !ys.length) return [];
    const xIds = this.uniqueIds(xs);
    const yIds = this.uniqueIds(ys);
    const pairs: Array<[XElement, XElement]> = [];
    const keyed = (el: XElement, ids: Map<string, XElement>): boolean => {
      const id = idOf(el);
      return id !== undefined && ids.get(id) === el;
    };
    for (const child of xs) {
      if (!keyed(child, xIds)) continue;
      const counterpart = yIds.get(idOf(child)!);
      if (counterpart) pairs.push([child, counterpart]);
    }
    const groups = new Map<string, { xs: XElement[]; ys: XElement[] }>();
    const group = (el: XElement): { xs: XElement[]; ys: XElement[] } => {
      const key = `${el.uri} ${el.local}`;
      let entry = groups.get(key);
      if (!entry) groups.set(key, (entry = { xs: [], ys: [] }));
      return entry;
    };
    for (const child of xs) if (!keyed(child, xIds) && idOf(child) === undefined) group(child).xs.push(child);
    for (const child of ys) if (!keyed(child, yIds) && idOf(child) === undefined) group(child).ys.push(child);
    for (const entry of groups.values()) {
      if (!entry.xs.length || !entry.ys.length) continue;
      if (this.byText) pairs.push(...this.sequencePairs(entry.xs, entry.ys));
      else for (let index = 0; index < Math.min(entry.xs.length, entry.ys.length); index++) pairs.push([entry.xs[index]!, entry.ys[index]!]);
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
    const { left, right } = this;
    const xCount = xs.length;
    const yCount = ys.length;
    const used = { x: new Set<number>(), y: new Set<number>() };
    const pairs: Array<[XElement, XElement]> = [];
    if (xCount * yCount <= 250_000) {
      const tx = xs.map((el) => rawOf(left, el));
      const ty = ys.map((el) => rawOf(right, el));
      const rowWidth = yCount + 1;
      const dp = new Uint32Array((xCount + 1) * rowWidth);
      for (let xIndex = xCount - 1; xIndex >= 0; xIndex--) {
        for (let yIndex = yCount - 1; yIndex >= 0; yIndex--) {
          dp[xIndex * rowWidth + yIndex] = tx[xIndex] === ty[yIndex] ? dp[(xIndex + 1) * rowWidth + yIndex + 1]! + 1 : Math.max(dp[(xIndex + 1) * rowWidth + yIndex]!, dp[xIndex * rowWidth + yIndex + 1]!);
        }
      }
      for (let xIndex = 0, yIndex = 0; xIndex < xCount && yIndex < yCount; ) {
        if (tx[xIndex] === ty[yIndex]) {
          pairs.push([xs[xIndex]!, ys[yIndex]!]);
          used.x.add(xIndex);
          used.y.add(yIndex);
          xIndex++;
          yIndex++;
        } else if (dp[(xIndex + 1) * rowWidth + yIndex]! >= dp[xIndex * rowWidth + yIndex + 1]!) xIndex++;
        else yIndex++;
      }
    }
    const restX = xs.filter((_xElement, xIndex) => !used.x.has(xIndex));
    const restY = ys.filter((_yElement, yIndex) => !used.y.has(yIndex));
    for (let index = 0; index < Math.min(restX.length, restY.length); index++) pairs.push([restX[index]!, restY[index]!]);
    return pairs;
  }
}

import { XmlTextReader, type XDocument, type XElement } from './XmlTextReader.js';

type Pair = [XElement, XElement];

interface IdlessGroup {
  xs: XElement[];
  ys: XElement[];
}

export class ElementAligner {
  private static readonly MAX_TEXT_CELLS = 250_000;

  constructor(
    private readonly left: XDocument,
    private readonly right: XDocument,
    private readonly byText: boolean,
  ) {}

  counterparts(): Map<XElement, XElement> {
    const { left, right } = this;
    const map = new Map<XElement, XElement>();
    if (left.root.uri !== right.root.uri || left.root.local !== right.root.local) {
      return map;
    }
    const stack: Array<[XElement, XElement]> = [[left.root, right.root]];
    while (stack.length) {
      const [leftEl, rightEl] = stack.pop()!;
      map.set(leftEl, rightEl);
      stack.push(...this.pairChildren(leftEl, rightEl));
    }
    return map;
  }

  private pairChildren(leftEl: XElement, rightEl: XElement): Pair[] {
    const xs = XmlTextReader.elementChildren(leftEl);
    const ys = XmlTextReader.elementChildren(rightEl);
    if (!xs.length || !ys.length) {
      return [];
    }
    const xIds = this.uniqueIds(xs);
    const yIds = this.uniqueIds(ys);
    const pairs: Pair[] = [];
    for (const child of xs) {
      const id = XmlTextReader.idOf(child);
      const counterpart = id !== undefined && xIds.get(id) === child ? yIds.get(id) : undefined;
      if (counterpart) {
        pairs.push([child, counterpart]);
      }
    }
    for (const group of this.idlessGroups(xs, ys).values()) {
      pairs.push(...this.pairGroup(group));
    }
    return pairs;
  }

  private idlessGroups(xs: XElement[], ys: XElement[]): Map<string, IdlessGroup> {
    const groups = new Map<string, IdlessGroup>();
    const add = (element: XElement, side: 'xs' | 'ys'): void => {
      if (XmlTextReader.idOf(element) === undefined) {
        const key = `${element.uri} ${element.local}`;
        const group = groups.get(key) ?? { xs: [], ys: [] };
        groups.set(key, group);
        group[side].push(element);
      }
    };
    xs.forEach((element) => add(element, 'xs'));
    ys.forEach((element) => add(element, 'ys'));
    return groups;
  }

  private pairGroup({ xs, ys }: IdlessGroup): Pair[] {
    if (!xs.length || !ys.length) {
      return [];
    }
    return this.byText ? this.sequencePairs(xs, ys) : ElementAligner.inOrder(xs, ys);
  }

  private static inOrder(xs: readonly XElement[], ys: readonly XElement[]): Pair[] {
    return xs.slice(0, ys.length).map((element, index) => [element, ys[index]!]);
  }

  private uniqueIds(els: XElement[]): Map<string, XElement> {
    const seen = new Map<string, XElement | null>();
    for (const el of els) {
      const id = XmlTextReader.idOf(el);
      if (id === undefined) {
        continue;
      }
      seen.set(id, seen.has(id) ? null : el);
    }
    const out = new Map<string, XElement>();
    for (const [id, el] of seen) {
      if (el) {
        out.set(id, el);
      }
    }
    return out;
  }

  private sequencePairs(xs: XElement[], ys: XElement[]): Pair[] {
    const pairs = xs.length * ys.length <= ElementAligner.MAX_TEXT_CELLS ? this.equalTextPairs(xs, ys) : [];
    const usedX = new Set(pairs.map(([element]) => element));
    const usedY = new Set(pairs.map(([, element]) => element));
    const rest = ElementAligner.inOrder(
      xs.filter((element) => !usedX.has(element)),
      ys.filter((element) => !usedY.has(element)),
    );
    return [...pairs, ...rest];
  }

  private equalTextPairs(xs: XElement[], ys: XElement[]): Pair[] {
    const leftTexts = xs.map((element) => XmlTextReader.rawOf(this.left, element));
    const rightTexts = ys.map((element) => XmlTextReader.rawOf(this.right, element));
    const rowWidth = ys.length + 1;
    const lengths = ElementAligner.commonLengths(leftTexts, rightTexts);
    const pairs: Pair[] = [];
    for (let xIndex = 0, yIndex = 0; xIndex < xs.length && yIndex < ys.length; ) {
      if (leftTexts[xIndex] === rightTexts[yIndex]) {
        pairs.push([xs[xIndex]!, ys[yIndex]!]);
        xIndex++;
        yIndex++;
      } else if (lengths[(xIndex + 1) * rowWidth + yIndex]! >= lengths[xIndex * rowWidth + yIndex + 1]!) {
        xIndex++;
      } else {
        yIndex++;
      }
    }
    return pairs;
  }

  private static commonLengths(leftTexts: readonly string[], rightTexts: readonly string[]): Uint32Array {
    const rowWidth = rightTexts.length + 1;
    const lengths = new Uint32Array((leftTexts.length + 1) * rowWidth);
    for (let xIndex = leftTexts.length - 1; xIndex >= 0; xIndex--) {
      for (let yIndex = rightTexts.length - 1; yIndex >= 0; yIndex--) {
        const skipped = Math.max(lengths[(xIndex + 1) * rowWidth + yIndex]!, lengths[xIndex * rowWidth + yIndex + 1]!);
        lengths[xIndex * rowWidth + yIndex] = leftTexts[xIndex] === rightTexts[yIndex] ? lengths[(xIndex + 1) * rowWidth + yIndex + 1]! + 1 : skipped;
      }
    }
    return lengths;
  }
}

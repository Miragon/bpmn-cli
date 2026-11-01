type SpaceUnit = 'column' | 'row' | 'px';

export type ParsedSpaceAmount = { count: number; unit: SpaceUnit };

export class SpaceAmount {
  private static readonly UNIT_BY_FIRST_LETTER: Readonly<Record<string, SpaceUnit>> = { c: 'column', r: 'row', p: 'px' };

  static parse(value: unknown): ParsedSpaceAmount | undefined {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value !== 0 ? { count: value, unit: 'px' } : undefined;
    }
    const match = typeof value === 'string' ? /^\s*(-?)\s*(\d*)\s*(px|cols?|columns?|rows?)?\s*$/i.exec(value) : null;
    if (!match || (!match[2] && (!match[3] || /^px$/i.test(match[3])))) {
      return undefined;
    }
    const count = (match[1] ? -1 : 1) * (match[2] ? Number(match[2]) : 1);
    return count === 0 ? undefined : { count, unit: SpaceAmount.UNIT_BY_FIRST_LETTER[(match[3] ?? 'px')[0]!.toLowerCase()]! };
  }
}

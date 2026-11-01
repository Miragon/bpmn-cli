import type { Plane } from '../../plane/Plane.js';
import type { SpaceTool } from '../space/SpaceTool.js';
import { SeparationRun, type SeparateOptions, type SeparateResult } from './SeparationRun.js';

export type { SeparateOptions, SeparateResult } from './SeparationRun.js';

export class Separation {
  constructor(
    private readonly plane: Plane,
    private readonly space: SpaceTool,
  ) {}

  separate(options: SeparateOptions): SeparateResult {
    return new SeparationRun(this.plane, this.space, options).run();
  }

  tidy({ ids, gap }: { ids?: Iterable<string>; gap?: number } = {}): { moved: string[]; resized: string[]; unresolved: Array<[string, string]> } {
    const active = ids ? [...ids] : this.plane.leaves().map((shape) => shape.id);
    const { moved, resized, unresolved } = this.separate({ active, movable: active, ...(gap !== undefined ? { gap } : {}) });
    return { moved: [...moved], resized: [...resized], unresolved };
  }
}

import type { El } from '../model/utils/moddle.js';
import { allIds, claimUnique, diStyles, rootDiId, styledId, type Style } from './utils/di-ids.js';

/** Id factory for new DI in the style most DI of the file already uses (default `<id>_di`); every id it gives is claimed. */
export class DiIds {
  private readonly styles: { shape?: Style; edge?: Style };
  private readonly taken: Set<string>;

  constructor(defs: El) {
    this.styles = diStyles(defs);
    this.taken = allIds(defs);
  }

  readonly shape = (id: string): string => claimUnique(this.taken, styledId(this.styles.shape ?? 'suffix', 'Shape', id));
  readonly edge = (id: string): string => claimUnique(this.taken, styledId(this.styles.edge ?? 'suffix', 'Edge', id));
  readonly plane = (id: string): string => claimUnique(this.taken, rootDiId('Plane', id));
  readonly diagram = (id: string): string => claimUnique(this.taken, rootDiId('Diagram', id));
}

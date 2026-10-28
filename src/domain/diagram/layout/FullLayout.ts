import { DrawnElementIds, type GivenId } from '../di/DrawnElementIds.js';
import { Groups, type RedrawnGroups } from '../di/Groups.js';
import { DiIdMemo } from '../di/DiIdMemo.js';
import type { IdRequest } from '../../document/utils/requests.js';
import { CleanEngine } from './clean/CleanEngine.js';
import type { Model } from '../../document/utils/moddle.js';
import { resolveExpanded } from '../utils/expansion.js';

export interface LayoutWarningInfo {
  code: string;
  elementId: string;
  message: string;
  relatedElementIds: string[];
}

export interface LayoutOptions {
  /** sub-process ids that must be expanded (in addition to what the DI says) */
  expand?: Iterable<string>;
  /** sub-process ids that must be collapsed */
  collapse?: Iterable<string>;
  /** claims an id for a drawn element that has none (default: the id conventions) */
  allocateId?: (req: IdRequest) => string;
}

export interface LayoutResult {
  xml: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** elements without id that got one so that the diagram can refer to them */
  givenIds?: GivenId[];
  /** what the caller should know about the drawing (a group around nothing kept or moved) */
  notes?: string[];
}

/**
 * Replaces a model's DI with a fresh drawing from the clean engine.
 * Sub-processes stay expanded unless the old DI collapsed them; DI ids and group boxes survive.
 */
export class FullLayout {
  constructor(
    private readonly model: Model,
    private readonly opts: LayoutOptions = {},
  ) {}

  /**
   * Clobbers the model's in-memory DI; treat the returned XML as the truth.
   * Id-less elements get ids first, so the DI never says bpmnElement="undefined".
   */
  async run(): Promise<LayoutResult> {
    const givenIds = new DrawnElementIds(this.model.definitions).give(this.opts.allocateId);
    const given = givenIds.length ? { givenIds } : {};
    const expanded = resolveExpanded(this.model, this.opts);
    const diIds = DiIdMemo.remember(this.model.definitions);
    const groups = [...new Groups(this.model.definitions).remembered(), ...new Groups(this.model.definitions).undrawn()];
    const { warnings } = new CleanEngine(this.model, expanded, Groups.membersOf(groups)).run();
    const redrawn = new Groups(this.model.definitions).redraw(this.model.moddle, groups);
    diIds.restore(this.model.definitions);
    const { xml } = await this.model.moddle.toXML(this.model.definitions, { format: true });
    return { xml, warnings: warnings.map((warning) => ({ code: warning.code, elementId: warning.elementId, message: warning.message, relatedElementIds: [] })), expanded: [...expanded], ...given, ...this.groupNotes(redrawn) };
  }

  private groupNotes({ kept, moved }: RedrawnGroups): { notes?: string[] } {
    const stay = kept.filter((id) => !moved.includes(id));
    const notes: string[] = [];
    if (stay.length) notes.push(stay.length === 1 ? `group ${stay[0]} kept its box: no element inside it is drawn` : `groups ${stay.join(', ')} kept their boxes: no element inside them is drawn`);
    if (moved.length) notes.push(moved.length === 1 ? `group ${moved[0]} moved below the drawing: no element inside it is drawn and the redraw put shapes on its box` : `groups ${moved.join(', ')} moved below the drawing: no element inside them is drawn and the redraw put shapes on their boxes`);
    return notes.length ? { notes } : {};
  }
}

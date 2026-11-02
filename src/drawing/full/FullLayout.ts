import { DrawingIdMemory, type BpmnDocument, type LayoutRequests } from '../../model/index.js';
import { DrawnElementIds, type GivenId } from '../diagram/DrawnElementIds.js';
import type { RedrawnGroups } from '../groups/GroupRedraw.js';
import { Groups } from '../groups/Groups.js';
import { CleanEngine } from './pools/CleanEngine.js';
import { EngineDrawing, type Block } from './pools/EngineDrawing.js';

export type { Block, EngineDrawing };

export interface LayoutWarning {
  code: string;
  elementId: string;
  message: string;
  relatedElementIds: string[];
}

export interface FullLayoutReport {
  warnings: LayoutWarning[];
  expanded: string[];
  givenIds: GivenId[];
  notes: string[];
}

export class FullLayout {
  constructor(
    private readonly document: BpmnDocument,
    private readonly expansions: LayoutRequests,
  ) {}

  static engineDrawing(document: BpmnDocument, expansions: LayoutRequests): Promise<EngineDrawing> {
    return EngineDrawing.of(document, expansions);
  }

  private static groupNotes({ kept, moved }: RedrawnGroups): string[] {
    const stay = kept.filter((id) => !moved.includes(id));
    const notes: string[] = [];
    if (stay.length) {
      notes.push(stay.length === 1 ? `group ${stay[0]} kept its box: no element inside it is drawn` : `groups ${stay.join(', ')} kept their boxes: no element inside them is drawn`);
    }
    if (moved.length) {
      notes.push(moved.length === 1 ? `group ${moved[0]} moved below the drawing: no element inside it is drawn and the redraw put shapes on its box` : `groups ${moved.join(', ')} moved below the drawing: no element inside them is drawn and the redraw put shapes on their boxes`);
    }
    return notes;
  }

  draw(): FullLayoutReport {
    const { document, expansions } = this;
    const { tree, diagram } = document;
    const { definitions } = tree;
    const givenIds = new DrawnElementIds(document).give();
    tree.invalidate();
    const expanded = diagram.expandedIds(expansions.expansion());
    const drawingIds = DrawingIdMemory.remember(definitions);
    const before = new Groups(tree);
    const groups = [...before.remembered(), ...before.undrawn()];
    const { warnings } = new CleanEngine(document, expanded, Groups.membersOf(groups)).run();
    const redrawn = new Groups(tree).redraw(groups);
    drawingIds.restore(definitions);
    return { warnings: warnings.map((warning) => ({ ...warning, relatedElementIds: [] })), expanded: [...expanded], givenIds, notes: FullLayout.groupNotes(redrawn) };
  }
}

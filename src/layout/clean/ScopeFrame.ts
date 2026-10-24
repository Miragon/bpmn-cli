import { titleDepth } from '../../diagram/utils/text.js';
import { SIZES } from '../../diagram/utils/sizes.js';
import type { GNode, ScopeLayout } from '../../diagram/types.js';
import { ScopeLabels } from './ScopeLabels.js';

/** Labels may reach this close to the border of an expanded sub-process (into its padding). */
const LABEL_KEEP = 6;
/** Room between the title of an expanded sub-process and what is drawn below it. */
const TITLE_GAP = 4;

export class ScopeFrame {
  constructor(private readonly layout: ScopeLayout) {}

  /**
   * The width a pool or a lane needs for the content of its scope and the
   * labels that reach past it (an end event at the right edge has a label
   * wider than the event: labelOutsideFrame otherwise), and `left`, how far
   * labels reach left of the content (the lane padding holds it). Only the
   * frames use it; the content is placed with the scope's own size. Expanded
   * sub-processes are sized by fitSubProcess.
   */
  framedSize(): { width: number; left: number } {
    const labels = new ScopeLabels(this.layout).all();
    const left = Math.max(0, ...labels.map((l) => -l.x));
    return { width: Math.max(this.layout.width, ...labels.map((l) => l.x + l.width)) + left, left };
  }

  /**
   * Sizes an expanded sub-process around its laid-out content (this scope) and says where
   * the content sits in it (`childPad`, DiWriter emitNode): the padding
   * (SIZES.subProcessPadding) all round, wider where a label of the content
   * (ScopeLabels all, and the labels of its data objects and stores) reaches
   * further out than LABEL_KEEP px from the border (a label left of the
   * content moves it right), and at the top room for the title's lines and the
   * labels above the first row (a gateway's), TITLE_GAP below the title; never
   * smaller than SIZES.subProcessMin, the content centred in a wider frame.
   */
  fitSubProcess(node: GNode): void {
    const child = this.layout;
    const p = SIZES.subProcessPadding;
    const childLabels = new ScopeLabels(child);
    const labels = [...childLabels.all(), ...childLabels.data()];
    const left = Math.max(0, ...labels.map((l) => -l.x - (p.left - LABEL_KEEP)));
    const right = Math.max(child.width, ...labels.map((l) => l.x + l.width - (p.right - LABEL_KEEP)));
    const below = Math.max(child.height, ...labels.map((l) => l.y + l.height - (p.bottom - LABEL_KEEP)));
    const above = Math.max(0, ...labels.map((l) => -l.y));
    const inner = Math.ceil(left + right);
    node.width = Math.max(SIZES.subProcessMin.width, inner + p.left + p.right);
    const top = Math.max(p.top, Math.ceil(titleDepth(node.el.get<string | undefined>('name'), node.width) + TITLE_GAP + above));
    node.height = Math.max(SIZES.subProcessMin.height, Math.ceil(below) + top + p.bottom);
    node.childPad = { left, top, inner };
  }
}

import { titleDepth } from '../../drawing/utils/text.js';
import { SIZES } from '../../drawing/utils/sizes.js';
import type { GNode, ScopeLayout } from '../../drawing/types.js';
import { ScopeLabels } from './ScopeLabels.js';

/** labels may reach this far into a sub-process's padding */
const LABEL_KEEP = 6;
const TITLE_GAP = 4;

/** Sizes the frame around a scope's content: a pool, a lane or an expanded sub-process. */
export class ScopeFrame {
  constructor(private readonly layout: ScopeLayout) {}

  /**
   * Includes labels reaching past the content, e.g. an end event's at the right edge;
   * `left` is how far labels reach left of it.
   */
  framedSize(): { width: number; left: number } {
    const labels = new ScopeLabels(this.layout).all();
    const left = Math.max(0, ...labels.map((label) => -label.x));
    return { width: Math.max(this.layout.width, ...labels.map((label) => label.x + label.width)) + left, left };
  }

  /**
   * Padding grows where content labels reach past LABEL_KEEP, and at the top for the title.
   * `childPad` says where the content sits; a frame wider than the content centres it.
   */
  fitSubProcess(node: GNode): void {
    const child = this.layout;
    const padding = SIZES.subProcessPadding;
    const childLabels = new ScopeLabels(child);
    const labels = [...childLabels.all(), ...childLabels.data()];
    const left = Math.max(0, ...labels.map((label) => -label.x - (padding.left - LABEL_KEEP)));
    const right = Math.max(child.width, ...labels.map((label) => label.x + label.width - (padding.right - LABEL_KEEP)));
    const below = Math.max(child.height, ...labels.map((label) => label.y + label.height - (padding.bottom - LABEL_KEEP)));
    const above = Math.max(0, ...labels.map((label) => -label.y));
    const inner = Math.ceil(left + right);
    node.width = Math.max(SIZES.subProcessMin.width, inner + padding.left + padding.right);
    const top = Math.max(padding.top, Math.ceil(titleDepth(node.el.get<string | undefined>('name'), node.width) + TITLE_GAP + above));
    node.height = Math.max(SIZES.subProcessMin.height, Math.ceil(below) + top + padding.bottom);
    node.childPad = { left, top, inner };
  }
}

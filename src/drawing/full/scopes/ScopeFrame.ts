import { TextMetrics } from '@miragon/bpmn-render/text';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from './GNode.js';
import { ScopeLabels } from './ScopeLabels.js';

export class ScopeFrame {
  private static readonly LABEL_KEEP = 6;
  private static readonly TITLE_GAP = 4;

  constructor(private readonly layout: ScopeLayout) {}

  framedSize(): { width: number; left: number } {
    const labels = new ScopeLabels(this.layout).all();
    const left = Math.max(0, ...labels.map((label) => -label.x));
    return { width: Math.max(this.layout.width, ...labels.map((label) => label.right)) + left, left };
  }

  fitSubProcess(node: GNode): void {
    const child = this.layout;
    const padding = ShapeSizes.SUB_PROCESS_PADDING;
    const childLabels = new ScopeLabels(child);
    const labels = [...childLabels.all(), ...childLabels.data()];
    const keep = ScopeFrame.LABEL_KEEP;
    const left = Math.max(0, ...labels.map((label) => -label.x - (padding.left - keep)));
    const right = Math.max(child.width, ...labels.map((label) => label.right - (padding.right - keep)));
    const below = Math.max(child.height, ...labels.map((label) => label.bottom - (padding.bottom - keep)));
    const above = Math.max(0, ...labels.map((label) => -label.y));
    const inner = Math.ceil(left + right);
    node.width = Math.max(ShapeSizes.SUB_PROCESS_MIN.width, inner + padding.left + padding.right);
    const top = Math.max(padding.top, Math.ceil(TextMetrics.titleDepth(node.el.get<string | undefined>('name'), node.width) + ScopeFrame.TITLE_GAP + above));
    node.height = Math.max(ShapeSizes.SUB_PROCESS_MIN.height, Math.ceil(below) + top + padding.bottom);
    node.childPad = { left, top, inner };
  }
}

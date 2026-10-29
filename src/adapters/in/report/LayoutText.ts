import type { LayoutView } from '../../../domain/views/layout-view.js';
import { MetricsText } from './MetricsText.js';
import { INDENT, quote } from './utils/view-lines.js';

/**
 * `bpmn show --layout`: per diagram its columns and the frame tree with `row n: c0 id, ...` lines,
 * then colours, labels off their default side and the layout problems.
 */
export class LayoutText {
  constructor(private readonly view: LayoutView) {}

  text(): string {
    const view = this.view;
    const out: string[] = [];
    if (!view.diagrams.length) out.push('no diagram');
    for (const diagram of view.diagrams) {
      out.push(`diagram ${diagram.id} (${diagram.root})`);
      if (diagram.columns) {
        out.push(`${INDENT}columns: c0..c${diagram.columns - 1}${diagram.gaps.length ? `; wide gaps: ${diagram.gaps.map((gap) => `c${gap.after}|c${gap.after + 1} ${gap.width}px`).join(', ')}` : ''}`);
      }
      const depth = new Map<string, number>();
      for (const group of diagram.groups) {
        const level = group.parent !== undefined ? (depth.get(group.parent) ?? 0) + 1 : 1;
        depth.set(group.id, level);
        const pad = INDENT.repeat(level);
        out.push(`${pad}${group.kind} ${group.id}${group.name ? ` ${quote(group.name)}` : ''}`);
        group.rows.forEach((row, rowIndex) => {
          const gaps = group.gaps?.find((gap) => gap.row === rowIndex)?.before ?? [];
          const cells = row.map((id, position) => `${position === 0 ? '' : gaps.includes(position) ? ' … ' : ', '}c${group.columns[rowIndex]?.[position] ?? 0} ${id}`);
          out.push(`${pad}${INDENT}row ${rowIndex + 1}: ${cells.join('')}`);
        });
      }
    }
    if (view.colors.length) {
      out.push(`colors: ${view.colors.map((color) => `${color.id} ${color.color === 'custom' ? `custom(${[color.fill, color.stroke].filter(Boolean).join('/')})` : color.color}`).join(', ')}`);
    }
    if (view.labels.length) {
      out.push(`labels off their default side: ${view.labels.map((label) => `${label.id} ${label.side} (default ${label.default})`).join(', ')}`);
    }
    const metrics = new MetricsText(view.metrics);
    out.push(`layout quality: ${metrics.scoreLine()}`);
    out.push(...metrics.problemLines());
    return out.join('\n') + '\n';
  }
}

/**
 * `bpmn show --layout`: per diagram a `columns: c0..cN` line (with the wide
 * gaps between neighbouring columns), the frame tree with `row n: c0 id, c1
 * id, ...` lines (` … ` instead of `, ` where a wide gap splits the row), then
 * colors, labels off their default side, and the layout problems with ids.
 */
import type { LayoutView } from '../query/layout-view.js';
import { MetricsText } from './MetricsText.js';
import { INDENT, q } from './utils/view-lines.js';

export class LayoutText {
  constructor(private readonly view: LayoutView) {}

  text(): string {
    const view = this.view;
    const out: string[] = [];
    if (!view.diagrams.length) out.push('no diagram');
    for (const d of view.diagrams) {
      out.push(`diagram ${d.id} (${d.root})`);
      if (d.columns) out.push(`${INDENT}columns: c0..c${d.columns - 1}${d.gaps.length ? `; wide gaps: ${d.gaps.map((g) => `c${g.after}|c${g.after + 1} ${g.width}px`).join(', ')}` : ''}`);
      const depth = new Map<string, number>();
      for (const g of d.groups) {
        const level = g.parent !== undefined ? (depth.get(g.parent) ?? 0) + 1 : 1;
        depth.set(g.id, level);
        const pad = INDENT.repeat(level);
        out.push(`${pad}${g.kind} ${g.id}${g.name ? ` ${q(g.name)}` : ''}`);
        g.rows.forEach((row, i) => {
          const gaps = g.gaps?.find((x) => x.row === i)?.before ?? [];
          const cells = row.map((id, k) => `${k === 0 ? '' : gaps.includes(k) ? ' … ' : ', '}c${g.columns[i]?.[k] ?? 0} ${id}`);
          out.push(`${pad}${INDENT}row ${i + 1}: ${cells.join('')}`);
        });
      }
    }
    if (view.colors.length) out.push(`colors: ${view.colors.map((c) => `${c.id} ${c.color === 'custom' ? `custom(${[c.fill, c.stroke].filter(Boolean).join('/')})` : c.color}`).join(', ')}`);
    if (view.labels.length) out.push(`labels off their default side: ${view.labels.map((l) => `${l.id} ${l.side} (default ${l.default})`).join(', ')}`);
    const metrics = new MetricsText(view.metrics);
    out.push(`layout quality: ${metrics.scoreLine()}`);
    out.push(...metrics.problemLines());
    return out.join('\n') + '\n';
  }
}

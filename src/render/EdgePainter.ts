import type { Box, Point } from '../drawing/utils/geom.js';
import { raw } from '../drawing/utils/raw.js';
import type { DEdge } from '../drawing/types.js';
import { is, type El } from '../model/utils/moddle.js';
import { LabelPainter } from './LabelPainter.js';
import { Style } from './Style.js';
import { HALO_COLORS, type Item } from './types.js';
import { pointsBox, unionOf } from './utils/boxes.js';
import { attr, FILL, n } from './utils/svg.js';

interface Dir {
  p: Point;
  /** unit vector pointing out of the end */
  ux: number;
  uy: number;
}

export class EdgePainter {
  private readonly style: Style;

  constructor(private readonly edge: DEdge) {
    this.style = new Style(edge.di);
  }

  svg(): string {
    const e = this.edge;
    const st = this.style;
    const ink = st.stroke;
    const d = this.roundedPath();
    const end = this.endDir(false);
    const start = this.endDir(true);
    const path = (extra: string): string => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"${extra}/>`;
    if (e.kind === 'sequenceFlow') {
      let out = path('');
      if (end) out += this.arrow(end, 'filled');
      const source = raw<El>(e.el, 'sourceRef');
      if (start && source && raw(source, 'default') === e.el) {
        // the default slash, 10 px from the source, at 45 degrees to the line
        const cx = start.p.x - start.ux * 10;
        const cy = start.p.y - start.uy * 10;
        const vx = (-start.ux - start.uy) * 4.5;
        const vy = (-start.uy + start.ux) * 4.5;
        out += `<path d="M${n(cx - vx)} ${n(cy - vy)}L${n(cx + vx)} ${n(cy + vy)}" stroke="${ink}" stroke-width="1.5"/>`;
      } else if (start && source && raw(e.el, 'conditionExpression') && is(source, 'bpmn:Activity')) {
        // the conditional diamond at the source
        const ux = -start.ux;
        const uy = -start.uy;
        const p = start.p;
        const pt = (k: number, side: number): string => `${n(p.x + ux * k - uy * side)} ${n(p.y + uy * k + ux * side)}`;
        out += `<path d="M${pt(0, 0)}L${pt(8, 5)}L${pt(16, 0)}L${pt(8, -5)}Z" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
      }
      return out;
    }
    if (e.kind === 'messageFlow') {
      let out = path(' stroke-dasharray="10 6"');
      if (start) out += `<circle cx="${n(start.p.x)}" cy="${n(start.p.y)}" r="4" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
      if (end) out += this.arrow(end, 'white');
      if (this.carriesMessage()) out += this.envelope();
      return out;
    }
    const dotted = path(' stroke-dasharray="0.5 4.5" stroke-linecap="round"');
    if (e.kind === 'dataAssociation') return dotted + (end ? this.arrow(end, 'open') : '');
    if (e.kind === 'association') {
      const direction = raw<string>(e.el, 'associationDirection');
      let out = dotted;
      if (end && (direction === 'One' || direction === 'Both')) out += this.arrow(end, 'open');
      if (start && direction === 'Both') out += this.arrow(start, 'open');
      return out;
    }
    return path('');
  }

  halo(color: string): string {
    const light = color === HALO_COLORS.moved;
    return `<path d="${this.roundedPath()}" fill="none" stroke="${color}" stroke-opacity="${light ? 0.3 : 0.45}" stroke-width="${light ? 7 : 9}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  box(): Box {
    const box = pointsBox(this.edge.points);
    if (!this.carriesMessage()) return box;
    const m = this.halfway();
    return unionOf([box, { x: m.x - 10.5, y: m.y - 7, width: 21, height: 14 }])!;
  }

  label(): Item | undefined {
    const e = this.edge;
    if (e.kind !== 'sequenceFlow' && e.kind !== 'messageFlow') return undefined;
    const value = raw<string>(e.el, 'name');
    if (!value || !value.trim()) return undefined;
    const text = new LabelPainter(this.style.label);
    if (e.label) return text.external(e.id, value, e.label.x + e.label.width / 2, Math.round(e.label.y), e.label.width);
    const mid = this.flowLabelMid();
    return text.external(e.id, value, mid.x, Math.round(mid.y - 10));
  }

  /**
   * Placed where bpmn-js 18 puts it on import: left edge at the flow's middle, 10 px below.
   * bpmn-js centres it below the envelope only when it redraws the flow after an edit.
   */
  messageLabel(): Item | undefined {
    if (!this.carriesMessage()) return undefined;
    const value = raw<string>(raw(this.edge.el, 'messageRef'), 'name');
    if (!value || !value.trim()) return undefined;
    return new LabelPainter(this.style.stroke).message(this.edge.id, value, this.halfway());
  }

  private carriesMessage(): boolean {
    const e = this.edge;
    return e.kind === 'messageFlow' && !!raw(e.el, 'messageRef') && e.points.length >= 2;
  }

  /** Outlined for messageVisibleKind "initiating" (the DI default), filled for "non_initiating". */
  private envelope(): string {
    const e = this.edge;
    const st = this.style;
    const m = this.halfway();
    const initiating = raw(e.di, 'messageVisibleKind') === 'initiating';
    const x = m.x - 10.5;
    const y = m.y - 7;
    return `<path data-message="${attr(e.id)}" d="M${n(x)} ${n(y)}v14h21v-14ZL${n(m.x)} ${n(y + 6)}L${n(x + 21)} ${n(y)}" fill="${initiating ? st.fill : st.stroke}" stroke="${initiating ? st.stroke : st.fill}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private halfway(): Point {
    const points = this.edge.points;
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    let rest = lengths.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      const d = lengths[i]!;
      if (rest <= d && d > 0) {
        const a = points[i]!;
        const b = points[i + 1]!;
        return { x: a.x + ((b.x - a.x) * rest) / d, y: a.y + ((b.y - a.y) * rest) / d };
      }
      rest -= d;
    }
    return points[points.length - 1]!;
  }

  /** bpmn-js: the middle of the middle segment, 15 px above it (right of a vertical one). */
  private flowLabelMid(): Point {
    const points = this.edge.points;
    const m = points.length / 2 - 1;
    const a = points[Math.max(0, Math.floor(m))]!;
    const b = points[Math.min(points.length - 1, Math.ceil(m + 0.01))]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const angle = Math.atan((b.y - a.y) / (b.x - a.x));
    return Math.abs(angle) < Math.PI / 2 ? { x: mid.x, y: mid.y - 15 } : { x: mid.x + 15, y: mid.y };
  }

  private endDir(atStart: boolean): Dir | undefined {
    const points = this.edge.points;
    const pts = atStart ? [...points].reverse() : points;
    const p = pts[pts.length - 1]!;
    for (let i = pts.length - 2; i >= 0; i--) {
      const q = pts[i]!;
      const len = Math.hypot(p.x - q.x, p.y - q.y);
      if (len > 0.01) return { p, ux: (p.x - q.x) / len, uy: (p.y - q.y) / len };
    }
    return undefined;
  }

  private arrow(d: Dir, kind: 'filled' | 'white' | 'open'): string {
    const ink = this.style.stroke;
    const len = kind === 'open' ? 10 : 11;
    const half = kind === 'open' ? 5 : 4;
    const bx = d.p.x - d.ux * len;
    const by = d.p.y - d.uy * len;
    const a = `${n(bx - d.uy * half)} ${n(by + d.ux * half)}`;
    const c = `${n(bx + d.uy * half)} ${n(by - d.ux * half)}`;
    const tip = `${n(d.p.x)} ${n(d.p.y)}`;
    if (kind === 'open') return `<path d="M${a}L${tip}L${c}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    return `<path d="M${a}L${tip}L${c}Z" fill="${kind === 'filled' ? ink : FILL}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private roundedPath(): string {
    const points = this.edge.points;
    const first = points[0]!;
    let d = `M${n(first.x)} ${n(first.y)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1]!;
      const p = points[i]!;
      const next = points[i + 1]!;
      const lin = Math.hypot(p.x - prev.x, p.y - prev.y);
      const lout = Math.hypot(next.x - p.x, next.y - p.y);
      const r = Math.min(5, lin / 2, lout / 2);
      if (r < 0.5) {
        d += `L${n(p.x)} ${n(p.y)}`;
        continue;
      }
      d += `L${n(p.x - ((p.x - prev.x) / lin) * r)} ${n(p.y - ((p.y - prev.y) / lin) * r)}Q${n(p.x)} ${n(p.y)} ${n(p.x + ((next.x - p.x) / lout) * r)} ${n(p.y + ((next.y - p.y) / lout) * r)}`;
    }
    const last = points[points.length - 1]!;
    return `${d}L${n(last.x)} ${n(last.y)}`;
  }
}

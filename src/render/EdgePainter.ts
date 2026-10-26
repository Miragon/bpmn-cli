import type { Box, Point } from '../drawing/utils/geom.js';
import { cx, unionAll } from '../drawing/utils/geom.js';
import { raw } from '../drawing/utils/raw.js';
import type { DEdge } from '../drawing/types.js';
import { is, type El } from '../model/utils/moddle.js';
import { LabelPainter } from './LabelPainter.js';
import { Style } from './Style.js';
import { HALO_COLORS, type Item } from './types.js';
import { pointsBox } from './utils/boxes.js';
import { attr, FILL, formatNumber } from './utils/svg.js';

interface Dir {
  tip: Point;
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
    const edge = this.edge;
    const st = this.style;
    const ink = st.stroke;
    const pathData = this.roundedPath();
    const end = this.endDir(false);
    const start = this.endDir(true);
    const path = (extra: string): string => `<path d="${pathData}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"${extra}/>`;
    if (edge.kind === 'sequenceFlow') {
      let out = path('');
      if (end) out += this.arrow(end, 'filled');
      const source = raw<El>(edge.el, 'sourceRef');
      if (start && source && raw(source, 'default') === edge.el) {
        // the default slash, 10 px from the source, at 45 degrees to the line
        const cx = start.tip.x - start.ux * 10;
        const cy = start.tip.y - start.uy * 10;
        const vx = (-start.ux - start.uy) * 4.5;
        const vy = (-start.uy + start.ux) * 4.5;
        out += `<path d="M${formatNumber(cx - vx)} ${formatNumber(cy - vy)}L${formatNumber(cx + vx)} ${formatNumber(cy + vy)}" stroke="${ink}" stroke-width="1.5"/>`;
      } else if (start && source && raw(edge.el, 'conditionExpression') && is(source, 'bpmn:Activity')) {
        // the conditional diamond at the source
        const ux = -start.ux;
        const uy = -start.uy;
        const origin = start.tip;
        const pt = (along: number, side: number): string => `${formatNumber(origin.x + ux * along - uy * side)} ${formatNumber(origin.y + uy * along + ux * side)}`;
        out += `<path d="M${pt(0, 0)}L${pt(8, 5)}L${pt(16, 0)}L${pt(8, -5)}Z" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
      }
      return out;
    }
    if (edge.kind === 'messageFlow') {
      let out = path(' stroke-dasharray="10 6"');
      if (start) out += `<circle cx="${formatNumber(start.tip.x)}" cy="${formatNumber(start.tip.y)}" r="4" fill="${FILL}" stroke="${ink}" stroke-width="1.2"/>`;
      if (end) out += this.arrow(end, 'white');
      if (this.carriesMessage()) out += this.envelope();
      return out;
    }
    const dotted = path(' stroke-dasharray="0.5 4.5" stroke-linecap="round"');
    if (edge.kind === 'dataAssociation') return dotted + (end ? this.arrow(end, 'open') : '');
    if (edge.kind === 'association') {
      const direction = raw<string>(edge.el, 'associationDirection');
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
    const middle = this.halfway();
    return unionAll([box, { x: middle.x - 10.5, y: middle.y - 7, width: 21, height: 14 }])!;
  }

  label(): Item | undefined {
    const edge = this.edge;
    if (edge.kind !== 'sequenceFlow' && edge.kind !== 'messageFlow') return undefined;
    const value = raw<string>(edge.el, 'name');
    if (!value || !value.trim()) return undefined;
    const text = new LabelPainter(this.style.label);
    if (edge.label) return text.external(edge.id, value, cx(edge.label), Math.round(edge.label.y), edge.label.width);
    const mid = this.flowLabelMid();
    return text.external(edge.id, value, mid.x, Math.round(mid.y - 10));
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
    const edge = this.edge;
    return edge.kind === 'messageFlow' && !!raw(edge.el, 'messageRef') && edge.points.length >= 2;
  }

  /** Outlined for messageVisibleKind "initiating" (the DI default), filled for "non_initiating". */
  private envelope(): string {
    const edge = this.edge;
    const st = this.style;
    const middle = this.halfway();
    const initiating = raw(edge.di, 'messageVisibleKind') === 'initiating';
    const left = middle.x - 10.5;
    const top = middle.y - 7;
    return `<path data-message="${attr(edge.id)}" d="M${formatNumber(left)} ${formatNumber(top)}v14h21v-14ZL${formatNumber(middle.x)} ${formatNumber(top + 6)}L${formatNumber(left + 21)} ${formatNumber(top)}" fill="${initiating ? st.fill : st.stroke}" stroke="${initiating ? st.stroke : st.fill}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private halfway(): Point {
    const points = this.edge.points;
    const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
    let rest = lengths.reduce((total, length) => total + length, 0) / 2;
    for (let index = 0; index < lengths.length; index++) {
      const segmentLength = lengths[index]!;
      if (rest <= segmentLength && segmentLength > 0) {
        const start = points[index]!;
        const end = points[index + 1]!;
        return { x: start.x + ((end.x - start.x) * rest) / segmentLength, y: start.y + ((end.y - start.y) * rest) / segmentLength };
      }
      rest -= segmentLength;
    }
    return points[points.length - 1]!;
  }

  /** bpmn-js: the middle of the middle segment, 15 px above it (right of a vertical one). */
  private flowLabelMid(): Point {
    const points = this.edge.points;
    const middleIndex = points.length / 2 - 1;
    const start = points[Math.max(0, Math.floor(middleIndex))]!;
    const end = points[Math.min(points.length - 1, Math.ceil(middleIndex + 0.01))]!;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const angle = Math.atan((end.y - start.y) / (end.x - start.x));
    return Math.abs(angle) < Math.PI / 2 ? { x: mid.x, y: mid.y - 15 } : { x: mid.x + 15, y: mid.y };
  }

  private endDir(atStart: boolean): Dir | undefined {
    const points = this.edge.points;
    const pts = atStart ? [...points].reverse() : points;
    const tip = pts[pts.length - 1]!;
    for (let index = pts.length - 2; index >= 0; index--) {
      const previous = pts[index]!;
      const len = Math.hypot(tip.x - previous.x, tip.y - previous.y);
      if (len > 0.01) return { tip, ux: (tip.x - previous.x) / len, uy: (tip.y - previous.y) / len };
    }
    return undefined;
  }

  private arrow(direction: Dir, kind: 'filled' | 'white' | 'open'): string {
    const ink = this.style.stroke;
    const len = kind === 'open' ? 10 : 11;
    const half = kind === 'open' ? 5 : 4;
    const bx = direction.tip.x - direction.ux * len;
    const by = direction.tip.y - direction.uy * len;
    const leftWing = `${formatNumber(bx - direction.uy * half)} ${formatNumber(by + direction.ux * half)}`;
    const rightWing = `${formatNumber(bx + direction.uy * half)} ${formatNumber(by - direction.ux * half)}`;
    const tip = `${formatNumber(direction.tip.x)} ${formatNumber(direction.tip.y)}`;
    if (kind === 'open') return `<path d="M${leftWing}L${tip}L${rightWing}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    return `<path d="M${leftWing}L${tip}L${rightWing}Z" fill="${kind === 'filled' ? ink : FILL}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private roundedPath(): string {
    const points = this.edge.points;
    const first = points[0]!;
    let pathData = `M${formatNumber(first.x)} ${formatNumber(first.y)}`;
    for (let index = 1; index < points.length - 1; index++) {
      const prev = points[index - 1]!;
      const corner = points[index]!;
      const next = points[index + 1]!;
      const lin = Math.hypot(corner.x - prev.x, corner.y - prev.y);
      const lout = Math.hypot(next.x - corner.x, next.y - corner.y);
      const radius = Math.min(5, lin / 2, lout / 2);
      if (radius < 0.5) {
        pathData += `L${formatNumber(corner.x)} ${formatNumber(corner.y)}`;
        continue;
      }
      pathData += `L${formatNumber(corner.x - ((corner.x - prev.x) / lin) * radius)} ${formatNumber(corner.y - ((corner.y - prev.y) / lin) * radius)}Q${formatNumber(corner.x)} ${formatNumber(corner.y)} ${formatNumber(corner.x + ((next.x - corner.x) / lout) * radius)} ${formatNumber(corner.y + ((next.y - corner.y) / lout) * radius)}`;
    }
    const last = points[points.length - 1]!;
    return `${pathData}L${formatNumber(last.x)} ${formatNumber(last.y)}`;
  }
}

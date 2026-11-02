import { Box, type PlaneEdge, type Point } from '../read/index.js';
import { LabelPainter, type PaintedLabel } from './LabelPainter.js';
import { Style } from './Style.js';
import { Svg } from './Svg.js';

interface EdgeEnd {
  tip: Point;
  unitX: number;
  unitY: number;
}

type ArrowKind = 'filled' | 'white' | 'open';

export class EdgePainter {
  private static readonly ENVELOPE_WIDTH = 21;
  private static readonly ENVELOPE_HEIGHT = 14;
  private static readonly DOTTED = ' stroke-dasharray="0.5 4.5" stroke-linecap="round"';

  private readonly style: Style;

  constructor(private readonly edge: PlaneEdge) {
    this.style = new Style(edge.planeElement);
  }

  svg(): string {
    switch (this.edge.kind) {
      case 'sequenceFlow':
        return this.sequenceFlow();
      case 'messageFlow':
        return this.messageFlow();
      case 'dataAssociation':
        return this.dataAssociation();
      case 'association':
        return this.association();
      default:
        return this.line('');
    }
  }

  box(): Box {
    const box = Box.spanning(this.edge.points) as Box;
    if (!this.carriesMessage()) {
      return box;
    }
    const middle = this.halfway();
    return box.union(new Box(middle.x - EdgePainter.ENVELOPE_WIDTH / 2, middle.y - EdgePainter.ENVELOPE_HEIGHT / 2, EdgePainter.ENVELOPE_WIDTH, EdgePainter.ENVELOPE_HEIGHT));
  }

  label(): PaintedLabel | undefined {
    const { id, kind, element, label } = this.edge;
    const value = element.text('name');
    if ((kind !== 'sequenceFlow' && kind !== 'messageFlow') || !value || !value.trim()) {
      return undefined;
    }
    const painter = new LabelPainter(this.style.label);
    if (label) {
      return painter.external(id, value, label.centerX, Math.round(label.y), label.width);
    }
    const middle = this.flowLabelMiddle();
    return painter.external(id, value, middle.x, Math.round(middle.y - 10));
  }

  messageLabel(): PaintedLabel | undefined {
    const value = this.edge.element.ref('messageRef')?.text('name');
    if (!this.carriesMessage() || !value || !value.trim()) {
      return undefined;
    }
    return new LabelPainter(this.style.stroke).message(this.edge.id, value, this.halfway());
  }

  private line(extra: string): string {
    return `<path d="${this.roundedPath()}" fill="none" stroke="${this.style.stroke}" stroke-width="1.5" stroke-linejoin="round"${extra}/>`;
  }

  private sequenceFlow(): string {
    const { element } = this.edge;
    const end = this.endOf(false);
    const start = this.endOf(true);
    const line = this.line('') + (end ? this.arrow(end, 'filled') : '');
    const source = element.ref('sourceRef');
    if (!start || !source) {
      return line;
    }
    if (element.sameAs(source.ref('default'))) {
      return line + this.defaultSlash(start);
    }
    return element.value('conditionExpression') && source.is('bpmn:Activity') ? line + this.conditionDiamond(start) : line;
  }

  private defaultSlash(start: EdgeEnd): string {
    const centerX = start.tip.x - start.unitX * 10;
    const centerY = start.tip.y - start.unitY * 10;
    const slashX = (-start.unitX - start.unitY) * 4.5;
    const slashY = (-start.unitY + start.unitX) * 4.5;
    return `<path d="M${Svg.number(centerX - slashX)} ${Svg.number(centerY - slashY)}L${Svg.number(centerX + slashX)} ${Svg.number(centerY + slashY)}" stroke="${this.style.stroke}" stroke-width="1.5"/>`;
  }

  private conditionDiamond(start: EdgeEnd): string {
    const alongX = -start.unitX;
    const alongY = -start.unitY;
    const corner = (along: number, side: number): string => `${Svg.number(start.tip.x + alongX * along - alongY * side)} ${Svg.number(start.tip.y + alongY * along + alongX * side)}`;
    return `<path d="M${corner(0, 0)}L${corner(8, 5)}L${corner(16, 0)}L${corner(8, -5)}Z" fill="${Svg.FILL}" stroke="${this.style.stroke}" stroke-width="1.2"/>`;
  }

  private messageFlow(): string {
    const end = this.endOf(false);
    const start = this.endOf(true);
    let painted = this.line(' stroke-dasharray="10 6"');
    if (start) {
      painted += `<circle cx="${Svg.number(start.tip.x)}" cy="${Svg.number(start.tip.y)}" r="4" fill="${Svg.FILL}" stroke="${this.style.stroke}" stroke-width="1.2"/>`;
    }
    if (end) {
      painted += this.arrow(end, 'white');
    }
    return this.carriesMessage() ? painted + this.envelope() : painted;
  }

  private dataAssociation(): string {
    const end = this.endOf(false);
    return this.line(EdgePainter.DOTTED) + (end ? this.arrow(end, 'open') : '');
  }

  private association(): string {
    const direction = this.edge.element.text('associationDirection');
    const end = this.endOf(false);
    const start = this.endOf(true);
    let painted = this.line(EdgePainter.DOTTED);
    if (end && (direction === 'One' || direction === 'Both')) {
      painted += this.arrow(end, 'open');
    }
    if (start && direction === 'Both') {
      painted += this.arrow(start, 'open');
    }
    return painted;
  }

  private carriesMessage(): boolean {
    const { kind, element, points } = this.edge;
    return kind === 'messageFlow' && !!element.value('messageRef') && points.length >= 2;
  }

  private envelope(): string {
    const { id, planeElement } = this.edge;
    const { fill, stroke } = this.style;
    const middle = this.halfway();
    const initiating = planeElement.value('messageVisibleKind') === 'initiating';
    const left = middle.x - EdgePainter.ENVELOPE_WIDTH / 2;
    const top = middle.y - EdgePainter.ENVELOPE_HEIGHT / 2;
    return `<path data-message="${Svg.attribute(id)}" d="M${Svg.number(left)} ${Svg.number(top)}v14h21v-14ZL${Svg.number(middle.x)} ${Svg.number(top + 6)}L${Svg.number(left + EdgePainter.ENVELOPE_WIDTH)} ${Svg.number(top)}" fill="${initiating ? fill : stroke}" stroke="${initiating ? stroke : fill}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private halfway(): Point {
    const { points } = this.edge;
    const lengths = points.slice(1).map((point, index) => EdgePainter.distance(points[index] as Point, point));
    let rest = lengths.reduce((total, length) => total + length, 0) / 2;
    for (const [index, length] of lengths.entries()) {
      if (rest <= length && length > 0) {
        const start = points[index] as Point;
        const end = points[index + 1] as Point;
        return { x: start.x + ((end.x - start.x) * rest) / length, y: start.y + ((end.y - start.y) * rest) / length };
      }
      rest -= length;
    }
    return points[points.length - 1] as Point;
  }

  private flowLabelMiddle(): Point {
    const { points } = this.edge;
    const middleIndex = points.length / 2 - 1;
    const start = points[Math.max(0, Math.floor(middleIndex))] as Point;
    const end = points[Math.min(points.length - 1, Math.ceil(middleIndex + 0.01))] as Point;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const angle = Math.atan((end.y - start.y) / (end.x - start.x));
    return Math.abs(angle) < Math.PI / 2 ? { x: middle.x, y: middle.y - 15 } : { x: middle.x + 15, y: middle.y };
  }

  private endOf(atStart: boolean): EdgeEnd | undefined {
    const points = atStart ? [...this.edge.points].reverse() : this.edge.points;
    const tip = points[points.length - 1] as Point;
    for (let index = points.length - 2; index >= 0; index--) {
      const previous = points[index] as Point;
      const length = EdgePainter.distance(tip, previous);
      if (length > 0.01) {
        return { tip, unitX: (tip.x - previous.x) / length, unitY: (tip.y - previous.y) / length };
      }
    }
    return undefined;
  }

  private arrow(end: EdgeEnd, kind: ArrowKind): string {
    const ink = this.style.stroke;
    const length = kind === 'open' ? 10 : 11;
    const half = kind === 'open' ? 5 : 4;
    const baseX = end.tip.x - end.unitX * length;
    const baseY = end.tip.y - end.unitY * length;
    const leftWing = `${Svg.number(baseX - end.unitY * half)} ${Svg.number(baseY + end.unitX * half)}`;
    const rightWing = `${Svg.number(baseX + end.unitY * half)} ${Svg.number(baseY - end.unitX * half)}`;
    const tip = `${Svg.number(end.tip.x)} ${Svg.number(end.tip.y)}`;
    if (kind === 'open') {
      return `<path d="M${leftWing}L${tip}L${rightWing}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    return `<path d="M${leftWing}L${tip}L${rightWing}Z" fill="${kind === 'filled' ? ink : Svg.FILL}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
  }

  private roundedPath(): string {
    const { points } = this.edge;
    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;
    const corners = points.slice(1, -1).map((corner, index) => EdgePainter.roundedCorner(points[index] as Point, corner, points[index + 2] as Point));
    return `M${Svg.number(first.x)} ${Svg.number(first.y)}${corners.join('')}L${Svg.number(last.x)} ${Svg.number(last.y)}`;
  }

  private static roundedCorner(previous: Point, corner: Point, next: Point): string {
    const lengthIn = EdgePainter.distance(corner, previous);
    const lengthOut = EdgePainter.distance(next, corner);
    const radius = Math.min(5, lengthIn / 2, lengthOut / 2);
    if (radius < 0.5) {
      return `L${Svg.number(corner.x)} ${Svg.number(corner.y)}`;
    }
    const entry = `${Svg.number(corner.x - ((corner.x - previous.x) / lengthIn) * radius)} ${Svg.number(corner.y - ((corner.y - previous.y) / lengthIn) * radius)}`;
    const exit = `${Svg.number(corner.x + ((next.x - corner.x) / lengthOut) * radius)} ${Svg.number(corner.y + ((next.y - corner.y) / lengthOut) * radius)}`;
    return `L${entry}Q${Svg.number(corner.x)} ${Svg.number(corner.y)} ${exit}`;
  }

  private static distance(first: Point, second: Point): number {
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}

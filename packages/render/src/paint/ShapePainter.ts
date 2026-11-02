import type { PlaneShape } from '../read/index.js';
import { ActivityPainter } from './ActivityPainter.js';
import { BandPainter } from './BandPainter.js';
import { DataPainter } from './DataPainter.js';
import { EventPainter } from './EventPainter.js';
import { GatewayPainter } from './GatewayPainter.js';
import { LabelPainter, type PaintedLabel } from './LabelPainter.js';
import { Style } from './Style.js';
import { Svg } from './Svg.js';

export class ShapePainter {
  private readonly style: Style;
  private readonly labels: LabelPainter;

  constructor(private readonly shape: PlaneShape) {
    this.style = new Style(shape.planeElement);
    this.labels = new LabelPainter(this.style.label);
  }

  svg(): string {
    const { shape, style, labels } = this;
    switch (shape.kind) {
      case 'event':
      case 'boundary':
        return new EventPainter(shape, style).svg();
      case 'gateway':
        return new GatewayPainter(shape, style).svg();
      case 'task':
      case 'subProcess':
        return new ActivityPainter(shape, style, labels).svg();
      case 'participant':
        return new BandPainter(shape, style, labels).pool();
      case 'lane':
        return new BandPainter(shape, style, labels).lane();
      case 'data':
        return new DataPainter(shape, style, labels).data();
      case 'annotation':
        return new DataPainter(shape, style, labels).annotation();
      case 'group':
        return `<rect ${Svg.box(shape.bounds)} rx="10" fill="none" stroke="${style.stroke}" stroke-width="1.5" stroke-dasharray="10 4 2 4"/>`;
      default:
        return this.unknown();
    }
  }

  label(): PaintedLabel | undefined {
    const { id, kind, bounds, label } = this.shape;
    const value = this.externalName();
    if (!value || !value.trim()) {
      return undefined;
    }
    if (label) {
      return this.labels.external(id, value, label.centerX, Math.round(label.y), label.width);
    }
    return this.labels.external(id, value, bounds.centerX, Math.round(kind === 'group' ? bounds.y : bounds.bottom));
  }

  private externalName(): string | undefined {
    const { element, kind } = this.shape;
    if (kind === 'group') {
      return element.ref('categoryValueRef')?.text('value');
    }
    return ['event', 'boundary', 'gateway', 'data'].includes(kind) ? element.text('name') : undefined;
  }

  private unknown(): string {
    const { element, bounds } = this.shape;
    const { filled, fill, stroke } = this.style;
    const name = element.text('name') ?? element.text('text');
    const frame = `<rect ${Svg.box(bounds)} fill="${filled ? fill : 'none'}" stroke="${stroke}" stroke-width="1"/>`;
    return frame + (name ? this.labels.inBox(name, bounds, { horizontal: 'center', vertical: 'middle', padding: 7 }) : '');
  }
}

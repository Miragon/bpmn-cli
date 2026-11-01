import type { PlaneShape } from '../read/index.js';
import { Box } from '../read/index.js';
import type { LabelPainter } from './LabelPainter.js';
import type { Style } from './Style.js';
import { Svg } from './Svg.js';

export class BandPainter {
  private static readonly LABEL_DEPTH = 30;

  constructor(
    private readonly shape: PlaneShape,
    private readonly style: Style,
    private readonly labels: LabelPainter,
  ) {}

  pool(): string {
    const { element, bounds } = this.shape;
    const { fill, stroke } = this.style;
    const frame = `<rect ${Svg.box(bounds)} fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    const content = element.value('processRef') ? this.separator() + this.bandLabel() : this.blackBoxName();
    return frame + content + this.multiplicity();
  }

  lane(): string {
    const { fill, filled, stroke } = this.style;
    const paint = filled ? `fill="${fill}" fill-opacity="0.35"` : 'fill="none"';
    return `<rect ${Svg.box(this.shape.bounds)} ${paint} stroke="${stroke}" stroke-width="1.5"/>${this.bandLabel()}`;
  }

  private horizontal(): boolean {
    return this.shape.di.value('isHorizontal') !== false;
  }

  private separator(): string {
    const { bounds } = this.shape;
    const depth = BandPainter.LABEL_DEPTH;
    const outline = this.horizontal() ? `M${Svg.number(bounds.x + depth)} ${Svg.number(bounds.y)}V${Svg.number(bounds.bottom)}` : `M${Svg.number(bounds.x)} ${Svg.number(bounds.y + depth)}H${Svg.number(bounds.right)}`;
    return `<path d="${outline}" stroke="${this.style.stroke}" stroke-width="1.5"/>`;
  }

  private blackBoxName(): string {
    const name = this.shape.element.text('name');
    return name && name.trim() ? this.labels.inBox(name, this.shape.bounds, { horizontal: 'center', vertical: 'middle', padding: 0 }) : '';
  }

  private bandLabel(): string {
    const { element, bounds } = this.shape;
    const name = element.text('name');
    if (!name || !name.trim()) {
      return '';
    }
    const depth = BandPainter.LABEL_DEPTH;
    if (!this.horizontal()) {
      return this.labels.inBox(name, new Box(bounds.x, bounds.y, bounds.width, depth), { horizontal: 'center', vertical: 'middle', padding: 0 });
    }
    const centerX = bounds.x + depth / 2;
    const centerY = bounds.centerY;
    const turned = new Box(centerX - bounds.height / 2, centerY - depth / 2, bounds.height, depth);
    return this.labels.inBox(name, turned, { horizontal: 'center', vertical: 'middle', padding: 0, transform: ` transform="rotate(-90 ${Svg.number(centerX)} ${Svg.number(centerY)})"` });
  }

  private multiplicity(): string {
    const { element, bounds } = this.shape;
    if (!element.value('participantMultiplicity')) {
      return '';
    }
    return Svg.at(bounds.centerX - 7, bounds.bottom - 16, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${this.style.stroke}" stroke-width="2"/>`);
  }
}

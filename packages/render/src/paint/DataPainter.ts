import type { PlaneShape } from '../read/index.js';
import type { LabelPainter } from './LabelPainter.js';
import type { Style } from './Style.js';
import { Svg } from './Svg.js';

export class DataPainter {
  constructor(
    private readonly shape: PlaneShape,
    private readonly style: Style,
    private readonly labels: LabelPainter,
  ) {}

  data(): string {
    return this.shape.element.is('bpmn:DataStoreReference') ? this.store() : this.object();
  }

  annotation(): string {
    const { element, bounds } = this.shape;
    const value = element.text('text');
    const bracket = `<path d="M${Svg.number(bounds.x + 10)} ${Svg.number(bounds.y)}H${Svg.number(bounds.x)}V${Svg.number(bounds.bottom)}H${Svg.number(bounds.x + 10)}" fill="none" stroke="${this.style.stroke}" stroke-width="1.5"/>`;
    return bracket + (value && value.trim() ? this.labels.inBox(value, bounds, { horizontal: 'left', vertical: 'top', padding: 7 }) : '');
  }

  private store(): string {
    const { bounds } = this.shape;
    const { fill, stroke: ink } = this.style;
    const radiusX = Svg.number(bounds.width / 2);
    const radiusY = Math.min(8, bounds.height / 6);
    const left = Svg.number(bounds.x);
    const right = Svg.number(bounds.right);
    const top = bounds.y + radiusY;
    const bottom = bounds.bottom - radiusY;
    const arc = `A${radiusX} ${Svg.number(radiusY)} 0 0 0 ${right}`;
    return (
      `<path d="M${left} ${Svg.number(top)}V${Svg.number(bottom)}${arc} ${Svg.number(bottom)}V${Svg.number(top)}" fill="${fill}" stroke="${ink}" stroke-width="2"/>` +
      `<ellipse cx="${Svg.number(bounds.centerX)}" cy="${Svg.number(top)}" rx="${radiusX}" ry="${Svg.number(radiusY)}" fill="${fill}" stroke="${ink}" stroke-width="2"/>` +
      `<path d="M${left} ${Svg.number(top + 5)}${arc} ${Svg.number(top + 5)}M${left} ${Svg.number(top + 10)}${arc} ${Svg.number(top + 10)}" fill="none" stroke="${ink}" stroke-width="1.2"/>`
    );
  }

  private object(): string {
    const { element, bounds } = this.shape;
    const { fill, stroke: ink } = this.style;
    const fold = Math.min(12, bounds.width / 3, bounds.height / 3);
    const foldX = Svg.number(bounds.right - fold);
    const foldY = Svg.number(bounds.y + fold);
    let painted =
      `<path d="M${Svg.number(bounds.x)} ${Svg.number(bounds.y)}H${foldX}L${Svg.number(bounds.right)} ${foldY}V${Svg.number(bounds.bottom)}H${Svg.number(bounds.x)}Z" fill="${fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M${foldX} ${Svg.number(bounds.y)}V${foldY}H${Svg.number(bounds.right)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
    const object = element.is('bpmn:DataObjectReference') ? element.ref('dataObjectRef') : element;
    if (object?.value('isCollection')) {
      painted += Svg.at(bounds.centerX - 7, bounds.bottom - 15, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${ink}" stroke-width="2"/>`);
    }
    const input = element.is('bpmn:DataInput');
    if (input || element.is('bpmn:DataOutput')) {
      painted += Svg.at(bounds.x + 4, bounds.y + 4, 1, `<path d="M1 4H7V1L13 6L7 11V8H1Z" fill="${input ? 'none' : ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
    }
    return painted;
  }
}

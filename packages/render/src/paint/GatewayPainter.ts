import type { PlaneShape } from '../read/index.js';
import type { Style } from './Style.js';
import { Svg } from './Svg.js';

export class GatewayPainter {
  private static readonly MARKER_SIZE = 50;

  constructor(
    private readonly shape: PlaneShape,
    private readonly style: Style,
  ) {}

  svg(): string {
    const { bounds } = this.shape;
    const { centerX, centerY } = bounds;
    const diamond = `<path d="M${Svg.number(centerX)} ${Svg.number(bounds.y)}L${Svg.number(bounds.right)} ${Svg.number(centerY)}L${Svg.number(centerX)} ${Svg.number(bounds.bottom)}L${Svg.number(bounds.x)} ${Svg.number(centerY)}Z" fill="${this.style.fill}" stroke="${this.style.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    const marker = this.marker();
    return marker ? diamond + Svg.at(centerX, centerY, Math.min(bounds.width, bounds.height) / GatewayPainter.MARKER_SIZE, marker) : diamond;
  }

  private marker(): string {
    const { element, di } = this.shape;
    if (element.is('bpmn:ParallelGateway')) {
      return this.bar('M0 -12V12M-12 0H12', 4.5);
    }
    if (element.is('bpmn:InclusiveGateway')) {
      return `<circle r="10.5" fill="none" stroke="${this.style.stroke}" stroke-width="3.5"/>`;
    }
    if (element.is('bpmn:ComplexGateway')) {
      return this.bar('M0 -12V12M-12 0H12M-8.5 -8.5L8.5 8.5M8.5 -8.5L-8.5 8.5', 4);
    }
    if (element.is('bpmn:EventBasedGateway')) {
      return this.eventBasedMarker();
    }
    return element.is('bpmn:ExclusiveGateway') && di.value('isMarkerVisible') === true ? this.bar('M-7.5 -9.5L7.5 9.5M7.5 -9.5L-7.5 9.5', 4.5) : '';
  }

  private eventBasedMarker(): string {
    const { element } = this.shape;
    const ink = this.style.stroke;
    const parallel = element.value('eventGatewayType') === 'Parallel';
    const instantiate = element.value('instantiate') === true;
    const ring = `<circle r="12" fill="none" stroke="${ink}" stroke-width="1.2"/>` + (parallel || instantiate ? '' : `<circle r="9.3" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
    const outline = parallel ? 'M-1.5 -7H1.5V-1.5H7V1.5H1.5V7H-1.5V1.5H-7V-1.5H-1.5Z' : 'M0 -5.5L5.2 -1.7L3.2 4.4L-3.2 4.4L-5.2 -1.7Z';
    return `${ring}<path d="${outline}" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }

  private bar(outline: string, strokeWidth: number): string {
    return `<path d="${outline}" fill="none" stroke="${this.style.stroke}" stroke-width="${strokeWidth}"/>`;
  }
}

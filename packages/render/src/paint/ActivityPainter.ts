import type { PlaneShape } from '../read/index.js';
import type { LabelPainter } from './LabelPainter.js';
import type { Style } from './Style.js';
import { Svg } from './Svg.js';

export class ActivityPainter {
  private static readonly MARKER_SIZE = 14;
  private static readonly MARKER_GAP = 3;

  constructor(
    private readonly shape: PlaneShape,
    private readonly style: Style,
    private readonly labels: LabelPainter,
  ) {}

  svg(): string {
    const { bounds, element, kind, expanded = false } = this.shape;
    let painted = this.frame();
    const icon = kind === 'task' ? this.taskIcon() : '';
    if (icon) {
      painted += Svg.at(bounds.x + 4, bounds.y + 4, 1, icon);
    }
    const name = element.text('name');
    if (name && name.trim()) {
      painted += this.labels.inBox(name, bounds, { horizontal: 'center', vertical: expanded ? 'top' : 'middle', padding: 7 });
    }
    const collapsed = (kind === 'subProcess' && !expanded) || element.is('bpmn:CallActivity');
    return painted + this.placedMarkers(this.markers(collapsed));
  }

  private frame(): string {
    const { element } = this.shape;
    if (element.is('bpmn:Transaction')) {
      return this.rect(0, 1.5) + this.rect(3, 1.5);
    }
    if (element.value('triggeredByEvent')) {
      return this.rect(0, 2, ' stroke-dasharray="1 4" stroke-linecap="round"');
    }
    return this.rect(0, element.is('bpmn:CallActivity') ? 5 : 2);
  }

  private rect(inset: number, strokeWidth: number, extra = ''): string {
    const { bounds } = this.shape;
    const width = Svg.number(Math.max(0, bounds.width - 2 * inset));
    const height = Svg.number(Math.max(0, bounds.height - 2 * inset));
    return `<rect x="${Svg.number(bounds.x + inset)}" y="${Svg.number(bounds.y + inset)}" width="${width}" height="${height}" rx="${10 - inset}" fill="${inset ? 'none' : this.style.fill}" stroke="${this.style.stroke}" stroke-width="${strokeWidth}"${extra}/>`;
  }

  private placedMarkers(markers: string[]): string {
    const { bounds } = this.shape;
    const size = ActivityPainter.MARKER_SIZE;
    const gap = ActivityPainter.MARKER_GAP;
    const total = markers.length * size + (markers.length - 1) * gap;
    return markers.map((marker, index) => Svg.at(bounds.x + bounds.width / 2 - total / 2 + index * (size + gap), bounds.y + bounds.height - 18, 1, marker)).join('');
  }

  private markers(collapsed: boolean): string[] {
    const { element } = this.shape;
    const ink = this.style.stroke;
    const markers = this.loopMarker();
    if (collapsed) {
      markers.push(`<rect x="0.5" y="0.5" width="13" height="13" fill="none" stroke="${ink}" stroke-width="1.2"/>${this.markerLine('M3.5 7H10.5M7 3.5V10.5')}`);
    }
    if (element.value('isForCompensation')) {
      markers.push(`<path d="M1 7L7 2.5V11.5ZM7 7L13 2.5V11.5Z" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
    }
    if (element.is('bpmn:AdHocSubProcess')) {
      markers.push(this.markerLine('M1 8C3.5 4 5.5 4 7 7C8.5 10 10.5 10 13 6'));
    }
    return markers;
  }

  private loopMarker(): string[] {
    const loop = this.shape.element.ref('loopCharacteristics');
    if (!loop) {
      return [];
    }
    if (!loop.is('bpmn:MultiInstanceLoopCharacteristics')) {
      return [this.markerLine('M4.2 11.8A5.5 5.5 0 1 1 9.8 11.8') + this.markerLine('M9.8 11.8L9.6 8.4M9.8 11.8L13 11')];
    }
    return [loop.value('isSequential') ? this.markerLine('M2 3H12M2 7H12M2 11H12', 2) : this.markerLine('M3 2V12M7 2V12M11 2V12', 2)];
  }

  private markerLine(outline: string, strokeWidth = 1.5): string {
    return `<path d="${outline}" fill="none" stroke="${this.style.stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  private iconLine(outline: string, strokeWidth = 1.2): string {
    return `<path d="${outline}" fill="none" stroke="${this.style.stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  private taskIcon(): string {
    const { element } = this.shape;
    const { stroke: ink, fill: paper } = this.style;
    if (element.is('bpmn:UserTask')) {
      return `<path d="M2 18V15C2 11.5 5 10 10 10C15 10 18 11.5 18 15V18Z" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="6" r="3.8" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>${this.iconLine('M6 18V15M14 18V15')}`;
    }
    if (element.is('bpmn:ManualTask')) {
      return this.iconLine('M2 11C2 7.5 4 6 7 6H17a1.2 1.2 0 0 1 0 2.4H11M11 8.4H18.5a1.2 1.2 0 0 1 0 2.4H11M11 10.8H18a1.2 1.2 0 0 1 0 2.4H11M11 13.2H16.5a1.2 1.2 0 0 1 0 2.4H7C4 15.6 2 14 2 11Z');
    }
    if (element.is('bpmn:ServiceTask')) {
      return `<circle cx="10" cy="10" r="6.6" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="2.59 2.59"/><circle cx="10" cy="10" r="5.2" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="10" r="2" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
    }
    if (element.is('bpmn:SendTask')) {
      return `<rect x="2" y="5" width="16" height="11" fill="${ink}" stroke="${ink}" stroke-width="1.2"/><path d="M2 5L10 11L18 5" fill="none" stroke="${paper}" stroke-width="1.2"/>`;
    }
    if (element.is('bpmn:ReceiveTask')) {
      return `<rect x="2" y="5" width="16" height="11" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>${this.iconLine('M2 5L10 11L18 5')}`;
    }
    if (element.is('bpmn:ScriptTask')) {
      return `<path d="M6 2H17C14 5 14 8 16 10.5C18 13 18 16 15 18H4C7 15 7 12 5 9.5C3 7 3 4 6 2Z" fill="${paper}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>${this.iconLine('M7.5 6H13.5M8.5 9.5H14.5M8.5 13H14.5', 1)}`;
    }
    if (element.is('bpmn:BusinessRuleTask')) {
      return `<rect x="2" y="4" width="16" height="12" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><rect x="2" y="4" width="16" height="3.5" fill="${ink}"/>${this.iconLine('M2 11.5H18M7 7.5V16', 1)}`;
    }
    return '';
  }
}

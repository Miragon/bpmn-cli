import type { Box } from '../../diagram/utils/geom.js';
import { grow } from '../../diagram/utils/geom.js';
import { raw, rawList } from '../../diagram/utils/raw.js';
import type { DShape } from '../../diagram/di/types.js';
import { titleBox, textWidth } from '../../diagram/utils/text.js';
import { groupName, is, type El } from '../../document/utils/moddle.js';
import { LabelPainter } from './LabelPainter.js';
import { Style } from './Style.js';
import { HALO_COLORS, type Item } from './types.js';
import { at, formatNumber } from '../utils/svg.js';

const TIMER_TICKS = 'M0 -7.6L0 -9.8M3.8 -6.6L4.9 -8.5M6.6 -3.8L8.5 -4.9M7.6 0L9.8 0M6.6 3.8L8.5 4.9M3.8 6.6L4.9 8.5M0 7.6L0 9.8M-3.8 6.6L-4.9 8.5M-6.6 3.8L-8.5 4.9M-7.6 0L-9.8 0M-6.6 -3.8L-8.5 -4.9M-3.8 -6.6L-4.9 -8.5';
const PENTAGON = 'M0 -8L7.6 -2.5L4.7 6.5L-4.7 6.5L-7.6 -2.5Z';
const PLUS = 'M-2 -9H2V-2H9V2H2V9H-2V2H-9V-2H-2Z';

export class ShapePainter {
  private readonly style: Style;
  private readonly text: LabelPainter;

  constructor(private readonly shape: DShape) {
    this.style = new Style(shape.di);
    this.text = new LabelPainter(this.style.label);
  }

  svg(): string {
    const shape = this.shape;
    const st = this.style;
    switch (shape.kind) {
      case 'event':
      case 'boundary':
        return this.event();
      case 'gateway':
        return this.gateway();
      case 'task':
        return this.activity(false);
      case 'subProcess':
        return this.activity(!!shape.expanded);
      case 'participant':
        return this.pool();
      case 'lane':
        return this.lane();
      case 'data':
        return this.data();
      case 'annotation':
        return this.annotation();
      case 'group': {
        const bounds = shape.bounds;
        return `<rect x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" rx="10" fill="none" stroke="${st.stroke}" stroke-width="1.5" stroke-dasharray="10 4 2 4"/>`;
      }
      default: {
        const bounds = shape.bounds;
        const name = raw<string>(shape.el, 'name') ?? raw<string>(shape.el, 'text');
        return `<rect x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" fill="${st.filled ? st.fill : 'none'}" stroke="${st.stroke}" stroke-width="1"/>` + (name ? this.text.inBox(name, bounds, 'center', 'middle', 7) : '');
      }
    }
  }

  halo(color: string): string {
    const shape = this.shape;
    const bounds = shape.bounds;
    // moved elements: lighter than created / changed ones
    const paint = `fill="none" stroke="${color}" stroke-opacity="${color === HALO_COLORS.moved ? 0.4 : 0.55}" stroke-width="${color === HALO_COLORS.moved ? 4 : 6}"`;
    if (shape.kind === 'event' || shape.kind === 'boundary') return `<circle cx="${formatNumber(bounds.x + bounds.width / 2)}" cy="${formatNumber(bounds.y + bounds.height / 2)}" r="${formatNumber(Math.min(bounds.width, bounds.height) / 2 + 6)}" ${paint}/>`;
    if (shape.kind === 'gateway') {
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      const offset = 8.5;
      return `<path d="M${formatNumber(cx)} ${formatNumber(bounds.y - offset)}L${formatNumber(bounds.x + bounds.width + offset)} ${formatNumber(cy)}L${formatNumber(cx)} ${formatNumber(bounds.y + bounds.height + offset)}L${formatNumber(bounds.x - offset)} ${formatNumber(cy)}Z" ${paint} stroke-linejoin="round"/>`;
    }
    const haloBox = grow(bounds, 6);
    return `<rect x="${formatNumber(haloBox.x)}" y="${formatNumber(haloBox.y)}" width="${formatNumber(haloBox.width)}" height="${formatNumber(haloBox.height)}" rx="12" ${paint}/>`;
  }

  label(): Item | undefined {
    const shape = this.shape;
    const external = shape.kind === 'event' || shape.kind === 'boundary' || shape.kind === 'gateway' || shape.kind === 'data' || shape.kind === 'group';
    if (!external) return undefined;
    const value = shape.kind === 'group' ? groupName(shape.el) : raw<string>(shape.el, 'name');
    if (!value || !value.trim()) return undefined;
    if (shape.label) return this.text.external(shape.id, value, shape.label.x + shape.label.width / 2, Math.round(shape.label.y), shape.label.width);
    const bounds = shape.bounds;
    // no label bounds: bpmn-js puts a 90 x 20 label below the shape (a group's at its top)
    return this.text.external(shape.id, value, bounds.x + bounds.width / 2, Math.round(shape.kind === 'group' ? bounds.y : bounds.y + bounds.height));
  }

  nameBox(): Box | undefined {
    const shape = this.shape;
    const name = shape.kind === 'group' ? undefined : raw<string>(shape.el, 'name');
    if (!name || !name.trim()) return undefined;
    const bounds = shape.bounds;
    if (shape.kind === 'subProcess') return titleBox(bounds, name);
    const blackBox = shape.kind === 'participant' && !raw(shape.el, 'processRef');
    if ((shape.kind === 'participant' || shape.kind === 'lane') && !blackBox) {
      if (this.horizontal()) {
        const nameHeight = Math.min(bounds.height, textWidth(name));
        return { x: bounds.x, y: bounds.y + (bounds.height - nameHeight) / 2, width: Math.min(30, bounds.width), height: nameHeight };
      }
      const nameWidth = Math.min(bounds.width, textWidth(name));
      return { x: bounds.x + (bounds.width - nameWidth) / 2, y: bounds.y, width: nameWidth, height: Math.min(30, bounds.height) };
    }
    const nameWidth = Math.min(bounds.width, textWidth(name) + 14);
    return { x: bounds.x + (bounds.width - nameWidth) / 2, y: bounds.y, width: nameWidth, height: blackBox ? bounds.height : Math.min(30, bounds.height) };
  }

  private horizontal(): boolean {
    return raw(this.shape.di, 'isHorizontal') !== false;
  }

  /** `full` for throwing events. */
  private triggerGlyph(el: El, full: boolean): string {
    const defs = rawList(el, 'eventDefinitions');
    if (!defs.length) return '';
    const ink = this.style.stroke;
    const paper = this.style.fill;
    const fill = full ? ink : paper;
    const shape = (pathData: string, extra = ''): string => `<path d="${pathData}" fill="${fill}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"${extra}/>`;
    if (defs.length > 1) return raw(el, 'parallelMultiple') ? shape(PLUS) : shape(PENTAGON);
    const definition = defs[0]!;
    if (is(definition, 'bpmn:MessageEventDefinition')) {
      return `<rect x="-8.5" y="-6" width="17" height="12" fill="${fill}" stroke="${ink}" stroke-width="1.2"/><path d="M-8.5 -6L0 0.8L8.5 -6" fill="none" stroke="${full ? paper : ink}" stroke-width="1.2"/>`;
    }
    if (is(definition, 'bpmn:TimerEventDefinition')) {
      return `<circle r="10.5" fill="${paper}" stroke="${ink}" stroke-width="1.5"/><path d="${TIMER_TICKS}" stroke="${ink}" stroke-width="1"/><path d="M0 -7L0 0L5 2.5" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    if (is(definition, 'bpmn:ConditionalEventDefinition')) {
      return `<rect x="-7" y="-9" width="14" height="18" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><path d="M-4.5 -5H4.5M-4.5 -1.5H4.5M-4.5 2H4.5M-4.5 5.5H4.5" stroke="${ink}" stroke-width="1"/>`;
    }
    if (is(definition, 'bpmn:SignalEventDefinition')) return shape('M0 -9.5L8.5 6H-8.5Z');
    if (is(definition, 'bpmn:EscalationEventDefinition')) return shape('M0 -9L7 8L0 2L-7 8Z');
    if (is(definition, 'bpmn:ErrorEventDefinition')) return shape('M-8 8L-3.5 -7.5L1.5 1.5L7.5 -8.5L3 7.5L-1.5 -1Z');
    if (is(definition, 'bpmn:LinkEventDefinition')) return shape('M-8 -3.5H1V-8L9 0L1 8V3.5H-8Z');
    if (is(definition, 'bpmn:CompensateEventDefinition')) return shape('M-8 0L0 -6V6ZM0 0L8 -6V6Z');
    if (is(definition, 'bpmn:CancelEventDefinition')) return shape('M-7 -9L0 -2L7 -9L9 -7L2 0L9 7L7 9L0 2L-7 9L-9 7L-2 0L-9 -7Z');
    if (is(definition, 'bpmn:TerminateEventDefinition')) return `<circle r="10.5" fill="${ink}"/>`;
    return '';
  }

  private event(): string {
    const shape = this.shape;
    const st = this.style;
    const bounds = shape.bounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const el = shape.el;
    const start = is(el, 'bpmn:StartEvent');
    const end = is(el, 'bpmn:EndEvent');
    const nonInterrupting = (shape.kind === 'boundary' && raw(el, 'cancelActivity') === false) || (start && raw(el, 'isInterrupting') === false);
    const dash = nonInterrupting ? ' stroke-dasharray="5.5 3"' : '';
    let out = `<circle cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" r="${formatNumber(radius)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${end ? 4 : start ? 2 : 1.5}"${dash}/>`;
    if (!start && !end) out += `<circle cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" r="${formatNumber(Math.max(1, radius - 3))}" fill="none" stroke="${st.stroke}" stroke-width="1.5"${dash}/>`;
    const glyph = this.triggerGlyph(el, end || is(el, 'bpmn:IntermediateThrowEvent'));
    return glyph ? out + at(cx, cy, radius / 18, glyph) : out;
  }

  private gatewayMarker(): string {
    const el = this.shape.el;
    const ink = this.style.stroke;
    const bar = (pathData: string, strokeWidth: number): string => `<path d="${pathData}" fill="none" stroke="${ink}" stroke-width="${strokeWidth}"/>`;
    if (is(el, 'bpmn:ParallelGateway')) return bar('M0 -12V12M-12 0H12', 4.5);
    if (is(el, 'bpmn:InclusiveGateway')) return `<circle r="10.5" fill="none" stroke="${ink}" stroke-width="3.5"/>`;
    if (is(el, 'bpmn:ComplexGateway')) return bar('M0 -12V12M-12 0H12M-8.5 -8.5L8.5 8.5M8.5 -8.5L-8.5 8.5', 4);
    if (is(el, 'bpmn:EventBasedGateway')) {
      const parallel = raw(el, 'eventGatewayType') === 'Parallel';
      const instantiate = raw(el, 'instantiate') === true;
      const ring = `<circle r="12" fill="none" stroke="${ink}" stroke-width="1.2"/>` + (parallel || instantiate ? '' : `<circle r="9.3" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
      return ring + `<path d="${parallel ? 'M-1.5 -7H1.5V-1.5H7V1.5H1.5V7H-1.5V1.5H-7V-1.5H-1.5Z' : 'M0 -5.5L5.2 -1.7L3.2 4.4L-3.2 4.4L-5.2 -1.7Z'}" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
    if (is(el, 'bpmn:ExclusiveGateway') && raw(this.shape.di, 'isMarkerVisible') === true) return bar('M-7.5 -9.5L7.5 9.5M7.5 -9.5L-7.5 9.5', 4.5);
    return '';
  }

  private gateway(): string {
    const st = this.style;
    const bounds = this.shape.bounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const diamond = `<path d="M${formatNumber(cx)} ${formatNumber(bounds.y)}L${formatNumber(bounds.x + bounds.width)} ${formatNumber(cy)}L${formatNumber(cx)} ${formatNumber(bounds.y + bounds.height)}L${formatNumber(bounds.x)} ${formatNumber(cy)}Z" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    const marker = this.gatewayMarker();
    return marker ? diamond + at(cx, cy, Math.min(bounds.width, bounds.height) / 50, marker) : diamond;
  }

  private taskIcon(): string {
    const el = this.shape.el;
    const ink = this.style.stroke;
    const paper = this.style.fill;
    const line = (pathData: string, strokeWidth = 1.2): string => `<path d="${pathData}" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (is(el, 'bpmn:UserTask')) {
      return `<path d="M2 18V15C2 11.5 5 10 10 10C15 10 18 11.5 18 15V18Z" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="6" r="3.8" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>` + line('M6 18V15M14 18V15');
    }
    if (is(el, 'bpmn:ManualTask')) {
      return line('M2 11C2 7.5 4 6 7 6H17a1.2 1.2 0 0 1 0 2.4H11M11 8.4H18.5a1.2 1.2 0 0 1 0 2.4H11M11 10.8H18a1.2 1.2 0 0 1 0 2.4H11M11 13.2H16.5a1.2 1.2 0 0 1 0 2.4H7C4 15.6 2 14 2 11Z');
    }
    if (is(el, 'bpmn:ServiceTask')) {
      return `<circle cx="10" cy="10" r="6.6" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="2.59 2.59"/><circle cx="10" cy="10" r="5.2" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><circle cx="10" cy="10" r="2" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
    }
    if (is(el, 'bpmn:SendTask')) {
      return `<rect x="2" y="5" width="16" height="11" fill="${ink}" stroke="${ink}" stroke-width="1.2"/><path d="M2 5L10 11L18 5" fill="none" stroke="${paper}" stroke-width="1.2"/>`;
    }
    if (is(el, 'bpmn:ReceiveTask')) {
      return `<rect x="2" y="5" width="16" height="11" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>` + line('M2 5L10 11L18 5');
    }
    if (is(el, 'bpmn:ScriptTask')) {
      return `<path d="M6 2H17C14 5 14 8 16 10.5C18 13 18 16 15 18H4C7 15 7 12 5 9.5C3 7 3 4 6 2Z" fill="${paper}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>` + line('M7.5 6H13.5M8.5 9.5H14.5M8.5 13H14.5', 1);
    }
    if (is(el, 'bpmn:BusinessRuleTask')) {
      return `<rect x="2" y="4" width="16" height="12" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><rect x="2" y="4" width="16" height="3.5" fill="${ink}"/>` + line('M2 11.5H18M7 7.5V16', 1);
    }
    return '';
  }

  private activityMarkers(collapsedSub: boolean): string[] {
    const el = this.shape.el;
    const ink = this.style.stroke;
    const line = (pathData: string, strokeWidth = 1.5): string => `<path d="${pathData}" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const out: string[] = [];
    const loop = raw<El>(el, 'loopCharacteristics');
    if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) out.push(raw(loop, 'isSequential') ? line('M2 3H12M2 7H12M2 11H12', 2) : line('M3 2V12M7 2V12M11 2V12', 2));
    else if (loop) out.push(line('M4.2 11.8A5.5 5.5 0 1 1 9.8 11.8') + line('M9.8 11.8L9.6 8.4M9.8 11.8L13 11'));
    if (collapsedSub) out.push(`<rect x="0.5" y="0.5" width="13" height="13" fill="none" stroke="${ink}" stroke-width="1.2"/>` + line('M3.5 7H10.5M7 3.5V10.5', 1.5));
    if (raw(el, 'isForCompensation')) out.push(`<path d="M1 7L7 2.5V11.5ZM7 7L13 2.5V11.5Z" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
    if (is(el, 'bpmn:AdHocSubProcess')) out.push(line('M1 8C3.5 4 5.5 4 7 7C8.5 10 10.5 10 13 6'));
    return out;
  }

  private activity(expanded: boolean): string {
    const shape = this.shape;
    const st = this.style;
    const bounds = shape.bounds;
    const el = shape.el;
    const rect = (inset: number, width: number, extra = ''): string =>
      `<rect x="${formatNumber(bounds.x + inset)}" y="${formatNumber(bounds.y + inset)}" width="${formatNumber(Math.max(0, bounds.width - 2 * inset))}" height="${formatNumber(Math.max(0, bounds.height - 2 * inset))}" rx="${10 - inset}" fill="${inset ? 'none' : st.fill}" stroke="${st.stroke}" stroke-width="${width}"${extra}/>`;
    let out: string;
    if (is(el, 'bpmn:Transaction')) out = rect(0, 1.5) + rect(3, 1.5);
    else if (raw(el, 'triggeredByEvent')) out = rect(0, 2, ' stroke-dasharray="1 4" stroke-linecap="round"');
    else out = rect(0, is(el, 'bpmn:CallActivity') ? 5 : 2);
    const icon = shape.kind === 'task' ? this.taskIcon() : '';
    if (icon) out += at(bounds.x + 4, bounds.y + 4, 1, icon);
    const name = raw<string>(el, 'name');
    // a call activity is drawn like a collapsed sub-process (bpmn-js: the + marker)
    const collapsed = (shape.kind === 'subProcess' && !expanded) || is(el, 'bpmn:CallActivity');
    if (name && name.trim()) out += this.text.inBox(name, bounds, 'center', expanded ? 'top' : 'middle', 7);
    const markers = this.activityMarkers(collapsed);
    const gap = 3;
    const total = markers.length * 14 + (markers.length - 1) * gap;
    markers.forEach((marker, index) => {
      out += at(bounds.x + bounds.width / 2 - total / 2 + index * (14 + gap), bounds.y + bounds.height - 18, 1, marker);
    });
    return out;
  }

  private bandLabel(): string {
    const name = raw<string>(this.shape.el, 'name');
    if (!name || !name.trim()) return '';
    const bounds = this.shape.bounds;
    if (!this.horizontal()) return this.text.inBox(name, { x: bounds.x, y: bounds.y, width: bounds.width, height: 30 }, 'center', 'middle', 0);
    // laid out as wide as the frame is high, then turned by -90 degrees around the band's centre
    const cx = bounds.x + 15;
    const cy = bounds.y + bounds.height / 2;
    const box = { x: cx - bounds.height / 2, y: cy - 15, width: bounds.height, height: 30 };
    return this.text.inBox(name, box, 'center', 'middle', 0, ` transform="rotate(-90 ${formatNumber(cx)} ${formatNumber(cy)})"`);
  }

  private pool(): string {
    const shape = this.shape;
    const st = this.style;
    const bounds = shape.bounds;
    let out = `<rect x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`;
    const blackBox = !raw(shape.el, 'processRef');
    if (blackBox) {
      const name = raw<string>(shape.el, 'name');
      if (name && name.trim()) out += this.text.inBox(name, bounds, 'center', 'middle', 0);
    } else {
      out += this.horizontal()
        ? `<path d="M${formatNumber(bounds.x + 30)} ${formatNumber(bounds.y)}V${formatNumber(bounds.y + bounds.height)}" stroke="${st.stroke}" stroke-width="1.5"/>`
        : `<path d="M${formatNumber(bounds.x)} ${formatNumber(bounds.y + 30)}H${formatNumber(bounds.x + bounds.width)}" stroke="${st.stroke}" stroke-width="1.5"/>`;
      out += this.bandLabel();
    }
    if (raw(shape.el, 'participantMultiplicity')) {
      out += at(bounds.x + bounds.width / 2 - 7, bounds.y + bounds.height - 16, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${st.stroke}" stroke-width="2"/>`);
    }
    return out;
  }

  private lane(): string {
    const st = this.style;
    const bounds = this.shape.bounds;
    const fill = st.filled ? `fill="${st.fill}" fill-opacity="0.35"` : 'fill="none"';
    return `<rect x="${formatNumber(bounds.x)}" y="${formatNumber(bounds.y)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}" ${fill} stroke="${st.stroke}" stroke-width="1.5"/>` + this.bandLabel();
  }

  private data(): string {
    const st = this.style;
    const bounds = this.shape.bounds;
    const el = this.shape.el;
    const ink = st.stroke;
    if (is(el, 'bpmn:DataStoreReference')) {
      const rx = bounds.width / 2;
      const ry = Math.min(8, bounds.height / 6);
      const x0 = formatNumber(bounds.x);
      const x1 = formatNumber(bounds.x + bounds.width);
      const top = bounds.y + ry;
      const bottom = bounds.y + bounds.height - ry;
      return (
        `<path d="M${x0} ${formatNumber(top)}V${formatNumber(bottom)}A${formatNumber(rx)} ${formatNumber(ry)} 0 0 0 ${x1} ${formatNumber(bottom)}V${formatNumber(top)}" fill="${st.fill}" stroke="${ink}" stroke-width="2"/>` +
        `<ellipse cx="${formatNumber(bounds.x + rx)}" cy="${formatNumber(top)}" rx="${formatNumber(rx)}" ry="${formatNumber(ry)}" fill="${st.fill}" stroke="${ink}" stroke-width="2"/>` +
        `<path d="M${x0} ${formatNumber(top + 5)}A${formatNumber(rx)} ${formatNumber(ry)} 0 0 0 ${x1} ${formatNumber(top + 5)}M${x0} ${formatNumber(top + 10)}A${formatNumber(rx)} ${formatNumber(ry)} 0 0 0 ${x1} ${formatNumber(top + 10)}" fill="none" stroke="${ink}" stroke-width="1.2"/>`
      );
    }
    const fold = Math.min(12, bounds.width / 3, bounds.height / 3);
    let out =
      `<path d="M${formatNumber(bounds.x)} ${formatNumber(bounds.y)}H${formatNumber(bounds.x + bounds.width - fold)}L${formatNumber(bounds.x + bounds.width)} ${formatNumber(bounds.y + fold)}V${formatNumber(bounds.y + bounds.height)}H${formatNumber(bounds.x)}Z" fill="${st.fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M${formatNumber(bounds.x + bounds.width - fold)} ${formatNumber(bounds.y)}V${formatNumber(bounds.y + fold)}H${formatNumber(bounds.x + bounds.width)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
    const object = is(el, 'bpmn:DataObjectReference') ? raw<El>(el, 'dataObjectRef') : el;
    if (raw(object, 'isCollection')) out += at(bounds.x + bounds.width / 2 - 7, bounds.y + bounds.height - 15, 1, `<path d="M3 2V12M7 2V12M11 2V12" fill="none" stroke="${ink}" stroke-width="2"/>`);
    const input = is(el, 'bpmn:DataInput');
    if (input || is(el, 'bpmn:DataOutput')) {
      out += at(bounds.x + 4, bounds.y + 4, 1, `<path d="M1 4H7V1L13 6L7 11V8H1Z" fill="${input ? 'none' : ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`);
    }
    return out;
  }

  private annotation(): string {
    const bounds = this.shape.bounds;
    const value = raw<string>(this.shape.el, 'text');
    return (
      `<path d="M${formatNumber(bounds.x + 10)} ${formatNumber(bounds.y)}H${formatNumber(bounds.x)}V${formatNumber(bounds.y + bounds.height)}H${formatNumber(bounds.x + 10)}" fill="none" stroke="${this.style.stroke}" stroke-width="1.5"/>` +
      (value && value.trim() ? this.text.inBox(value, bounds, 'left', 'top', 7) : '')
    );
  }
}

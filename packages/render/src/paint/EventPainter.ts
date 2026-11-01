import type { BpmnNode, PlaneShape } from '../read/index.js';
import type { Style } from './Style.js';
import { Svg } from './Svg.js';

export class EventPainter {
  private static readonly TIMER_TICKS = 'M0 -7.6L0 -9.8M3.8 -6.6L4.9 -8.5M6.6 -3.8L8.5 -4.9M7.6 0L9.8 0M6.6 3.8L8.5 4.9M3.8 6.6L4.9 8.5M0 7.6L0 9.8M-3.8 6.6L-4.9 8.5M-6.6 3.8L-8.5 4.9M-7.6 0L-9.8 0M-6.6 -3.8L-8.5 -4.9M-3.8 -6.6L-4.9 -8.5';
  private static readonly PENTAGON = 'M0 -8L7.6 -2.5L4.7 6.5L-4.7 6.5L-7.6 -2.5Z';
  private static readonly PLUS = 'M-2 -9H2V-2H9V2H2V9H-2V2H-9V-2H-2Z';
  private static readonly GLYPH_SIZE = 18;
  private static readonly SHAPED_GLYPHS: ReadonlyArray<readonly [string, string]> = [
    ['bpmn:SignalEventDefinition', 'M0 -9.5L8.5 6H-8.5Z'],
    ['bpmn:EscalationEventDefinition', 'M0 -9L7 8L0 2L-7 8Z'],
    ['bpmn:ErrorEventDefinition', 'M-8 8L-3.5 -7.5L1.5 1.5L7.5 -8.5L3 7.5L-1.5 -1Z'],
    ['bpmn:LinkEventDefinition', 'M-8 -3.5H1V-8L9 0L1 8V3.5H-8Z'],
    ['bpmn:CompensateEventDefinition', 'M-8 0L0 -6V6ZM0 0L8 -6V6Z'],
    ['bpmn:CancelEventDefinition', 'M-7 -9L0 -2L7 -9L9 -7L2 0L9 7L7 9L0 2L-7 9L-9 7L-2 0L-9 -7Z'],
  ];

  constructor(
    private readonly shape: PlaneShape,
    private readonly style: Style,
  ) {}

  svg(): string {
    const { bounds, element, kind } = this.shape;
    const { stroke, fill } = this.style;
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const start = element.is('bpmn:StartEvent');
    const end = element.is('bpmn:EndEvent');
    const nonInterrupting = (kind === 'boundary' && element.value('cancelActivity') === false) || (start && element.value('isInterrupting') === false);
    const dash = nonInterrupting ? ' stroke-dasharray="5.5 3"' : '';
    const center = `cx="${Svg.number(bounds.centerX)}" cy="${Svg.number(bounds.centerY)}"`;
    let painted = `<circle ${center} r="${Svg.number(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${EventPainter.ringWidth(start, end)}"${dash}/>`;
    if (!start && !end) {
      painted += `<circle ${center} r="${Svg.number(Math.max(1, radius - 3))}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash}/>`;
    }
    const glyph = this.triggerGlyph(end || element.is('bpmn:IntermediateThrowEvent'));
    return glyph ? painted + Svg.at(bounds.centerX, bounds.centerY, radius / EventPainter.GLYPH_SIZE, glyph) : painted;
  }

  private static ringWidth(start: boolean, end: boolean): number {
    if (end) {
      return 4;
    }
    return start ? 2 : 1.5;
  }

  private triggerGlyph(full: boolean): string {
    const { element } = this.shape;
    const definitions = element.list('eventDefinitions');
    const [definition] = definitions;
    if (!definition) {
      return '';
    }
    if (definitions.length > 1) {
      return this.shaped(element.value('parallelMultiple') ? EventPainter.PLUS : EventPainter.PENTAGON, full);
    }
    return this.definitionGlyph(definition, full);
  }

  private definitionGlyph(definition: BpmnNode, full: boolean): string {
    const { stroke: ink, fill: paper } = this.style;
    if (definition.is('bpmn:MessageEventDefinition')) {
      return `<rect x="-8.5" y="-6" width="17" height="12" fill="${full ? ink : paper}" stroke="${ink}" stroke-width="1.2"/><path d="M-8.5 -6L0 0.8L8.5 -6" fill="none" stroke="${full ? paper : ink}" stroke-width="1.2"/>`;
    }
    if (definition.is('bpmn:TimerEventDefinition')) {
      return `<circle r="10.5" fill="${paper}" stroke="${ink}" stroke-width="1.5"/><path d="${EventPainter.TIMER_TICKS}" stroke="${ink}" stroke-width="1"/><path d="M0 -7L0 0L5 2.5" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    if (definition.is('bpmn:ConditionalEventDefinition')) {
      return `<rect x="-7" y="-9" width="14" height="18" fill="${paper}" stroke="${ink}" stroke-width="1.2"/><path d="M-4.5 -5H4.5M-4.5 -1.5H4.5M-4.5 2H4.5M-4.5 5.5H4.5" stroke="${ink}" stroke-width="1"/>`;
    }
    if (definition.is('bpmn:TerminateEventDefinition')) {
      return `<circle r="10.5" fill="${ink}"/>`;
    }
    const outline = EventPainter.SHAPED_GLYPHS.find(([type]) => definition.is(type));
    return outline ? this.shaped(outline[1], full) : '';
  }

  private shaped(outline: string, full: boolean): string {
    const { stroke: ink, fill: paper } = this.style;
    return `<path d="${outline}" fill="${full ? ink : paper}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
}

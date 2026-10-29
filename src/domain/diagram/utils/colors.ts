/**
 * bpmn-js colour attributes of the DI: kept over a full redraw, written as colour picker swatches.
 * A label without its own colour falls back to the stroke in bpmn-js.
 */
import type { BpmnModdle } from 'bpmn-moddle';
import { is, type El } from '../../document/utils/moddle.js';
import { idOf, raw, rawList } from './raw.js';

const SHAPE_COLORS = ['bioc:stroke', 'bioc:fill', 'color:background-color', 'color:border-color'];

const EDGE_COLORS = ['bioc:stroke', 'bioc:fill', 'color:border-color'];

const LABEL_COLORS = ['color:color'];

export interface ColorAttrs {
  own: Record<string, string>;
  label: Record<string, string>;
}

function pick(el: El | undefined, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  for (const key of keys) {
    const value = el.get<string | undefined>(key);
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

export function colorsOf(defs: El): Map<string, ColorAttrs> {
  const out = new Map<string, ColorAttrs>();
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const id = idOf(raw(pe, 'bpmnElement'));
      if (!id) continue;
      const own = pick(pe, is(pe, 'bpmndi:BPMNEdge') ? EDGE_COLORS : SHAPE_COLORS);
      const label = pick(raw<El>(pe, 'label'), LABEL_COLORS);
      if (Object.keys(own).length || Object.keys(label).length) {
        out.set(id, { own, label });
      }
    }
  }
  return out;
}

export const SWATCHES = {
  blue: { fill: '#bbdefb', stroke: '#0d4372' },
  orange: { fill: '#ffe0b2', stroke: '#6b3c00' },
  green: { fill: '#c8e6c9', stroke: '#205022' },
  red: { fill: '#ffcdd2', stroke: '#831311' },
  purple: { fill: '#e1bee7', stroke: '#5b176d' },
} as const;

export type SwatchName = keyof typeof SWATCHES;

/** `undefined` removes every colour attribute; true when something changed. */
export function setSwatch(di: El, swatch: SwatchName | undefined): boolean {
  const edge = is(di, 'bpmndi:BPMNEdge');
  const before = JSON.stringify([pick(di, SHAPE_COLORS.concat(EDGE_COLORS)), pick(raw<El>(di, 'label'), LABEL_COLORS)]);
  for (const key of new Set([...SHAPE_COLORS, ...EDGE_COLORS])) {
    di.set(key, undefined);
  }
  const label = raw<El>(di, 'label');
  if (label) label.set('color:color', undefined);
  if (swatch) {
    const { fill, stroke } = SWATCHES[swatch];
    di.set('bioc:stroke', stroke);
    di.set('color:border-color', stroke);
    if (!edge) {
      di.set('bioc:fill', fill);
      di.set('color:background-color', fill);
    }
    if (label) label.set('color:color', stroke);
  }
  return JSON.stringify([pick(di, SHAPE_COLORS.concat(EDGE_COLORS)), pick(raw<El>(di, 'label'), LABEL_COLORS)]) !== before;
}

/** 'custom' for colours that are no swatch. */
export function swatchOf(di: El): { color: SwatchName | 'custom'; fill?: string; stroke?: string } | undefined {
  const own = pick(di, is(di, 'bpmndi:BPMNEdge') ? EDGE_COLORS : SHAPE_COLORS);
  const stroke = own['bioc:stroke'] ?? own['color:border-color'];
  const fill = own['bioc:fill'] ?? own['color:background-color'];
  if (!stroke && !fill) return undefined;
  const edge = is(di, 'bpmndi:BPMNEdge');
  const name = (Object.keys(SWATCHES) as SwatchName[]).find((swatch) => SWATCHES[swatch].stroke === stroke?.toLowerCase() && (edge || SWATCHES[swatch].fill === fill?.toLowerCase()));
  return { color: name ?? 'custom', ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
}

export function applyColors(moddle: BpmnModdle, defs: El, colors: Map<string, ColorAttrs>): number {
  if (!colors.size) return 0;
  let count = 0;
  for (const diagram of rawList(defs, 'diagrams')) {
    for (const pe of rawList(raw(diagram, 'plane'), 'planeElement')) {
      const elementColors = colors.get(idOf(raw(pe, 'bpmnElement')) ?? '');
      if (!elementColors) continue;
      for (const [key, value] of Object.entries(elementColors.own)) {
        pe.set(key, value);
      }
      if (Object.keys(elementColors.label).length) {
        let lbl = raw<El>(pe, 'label');
        if (!lbl) {
          lbl = moddle.create('bpmndi:BPMNLabel', {});
          pe.set('label', lbl);
          lbl.$parent = pe;
        }
        for (const [key, value] of Object.entries(elementColors.label)) {
          lbl.set(key, value);
        }
      }
      count++;
    }
  }
  return count;
}

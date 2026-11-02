import { describe, expect, it } from 'vitest';
import { Swatches } from '../../../src/drawing/diagram/Swatches.js';
import type { BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Swatches', () => {
  async function planeElementOf(id: string): Promise<BpmnElement> {
    const document = await Fixtures.read('drawing/colored.bpmn');
    return document.diagram.planes()[0]!.list('planeElement').find((element) => element.peek<BpmnElement>('bpmnElement')?.id === id)!;
  }

  it('paints a shape and its label with a swatch, and says it changed', async () => {
    const planeElement = await planeElementOf('labelled_end');

    expect(Swatches.set(planeElement, 'green')).toBe(true);
    expect(Swatches.colorsOf(planeElement, Swatches.SHAPE_COLORS)['bioc:stroke']).toBe(Swatches.TABLE.green.stroke);
    expect(planeElement.peek<BpmnElement>('label')!.get('color:color')).toBe(Swatches.TABLE.green.stroke);
    expect(Swatches.set(planeElement, 'green')).toBe(false);
  });

  it('gives an edge a stroke and no fill', async () => {
    const planeElement = await planeElementOf('custom_flow');

    Swatches.set(planeElement, 'red');

    expect(Swatches.colorsOf(planeElement, Swatches.EDGE_COLORS)).toEqual({ 'bioc:stroke': Swatches.TABLE.red.stroke, 'color:border-color': Swatches.TABLE.red.stroke });
  });

  it('takes every colour off without a swatch', async () => {
    const planeElement = await planeElementOf('blue_task');

    expect(Swatches.set(planeElement, undefined)).toBe(true);
    expect(Swatches.colorsOf(planeElement, Swatches.SHAPE_COLORS)).toEqual({});
  });
});

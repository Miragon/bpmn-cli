import { describe, expect, it } from 'vitest';
import { Swatches } from '../../../src/drawing/diagram/Swatches.js';
import type { BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Swatches', () => {
  async function diOf(id: string): Promise<BpmnElement> {
    const document = await Fixtures.read('drawing/colored.bpmn');
    return document.diagram.planes()[0]!.list('planeElement').find((element) => element.peek<BpmnElement>('bpmnElement')?.id === id)!;
  }

  it('paints a shape and its label with a swatch, and says it changed', async () => {
    const di = await diOf('labelled_end');

    expect(Swatches.set(di, 'green')).toBe(true);
    expect(Swatches.colorsOf(di, Swatches.SHAPE_COLORS)['bioc:stroke']).toBe(Swatches.TABLE.green.stroke);
    expect(di.peek<BpmnElement>('label')!.get('color:color')).toBe(Swatches.TABLE.green.stroke);
    expect(Swatches.set(di, 'green')).toBe(false);
  });

  it('gives an edge a stroke and no fill', async () => {
    const di = await diOf('custom_flow');

    Swatches.set(di, 'red');

    expect(Swatches.colorsOf(di, Swatches.EDGE_COLORS)).toEqual({ 'bioc:stroke': Swatches.TABLE.red.stroke, 'color:border-color': Swatches.TABLE.red.stroke });
  });

  it('takes every colour off without a swatch', async () => {
    const di = await diOf('blue_task');

    expect(Swatches.set(di, undefined)).toBe(true);
    expect(Swatches.colorsOf(di, Swatches.SHAPE_COLORS)).toEqual({});
  });
});

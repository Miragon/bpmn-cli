import { describe, expect, it } from 'vitest';
import { BpmnNode } from '../../src/read/BpmnNode.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('Style', () => {
  const planeElementWith = (attributes: Record<string, string>) => BpmnNode.of({ get: (key: string) => attributes[key] }) as BpmnNode;

  it('paints an element without colours in ink on white', async () => {
    const { planeElement } = await CorpusModel.shape('models/render/gallery.bpmn', 'Activity_UserTask');
    expect(new Style(planeElement)).toMatchObject({ fill: '#ffffff', stroke: '#22242a', label: '#22242a', filled: false });
  });

  it('reads the colours a modeler wrote, and the label colour of the BPMN label', async () => {
    const { planeElement } = await CorpusModel.shape('models/render/gallery.bpmn', 'Gateway_WhichPath');
    expect(new Style(planeElement)).toMatchObject({ fill: '#bbdefb', stroke: '#0d4372', label: '#0d4372', filled: true });
  });

  it('takes color: before bioc:', () => {
    expect(new Style(planeElementWith({ 'color:background-color': '#111', 'bioc:fill': '#222' })).fill).toBe('#111');
  });

  it('takes rgb() and named colours', () => {
    expect(new Style(planeElementWith({ 'bioc:stroke': 'rgb(1, 2, 3)' })).stroke).toBe('rgb(1, 2, 3)');
    expect(new Style(planeElementWith({ 'bioc:stroke': 'red' })).stroke).toBe('red');
  });

  it('ignores a colour that could break out of the attribute', () => {
    expect(new Style(planeElementWith({ 'bioc:fill': '"><script>' })).filled).toBe(false);
  });
});

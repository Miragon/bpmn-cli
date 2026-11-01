import { describe, expect, it } from 'vitest';
import { DataPainter } from '../../src/paint/DataPainter.js';
import { LabelPainter } from '../../src/paint/LabelPainter.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('DataPainter', () => {
  async function painterOf(id: string, path = 'models/render/gallery.bpmn'): Promise<DataPainter> {
    const shape = await CorpusModel.shape(path, id);
    const style = new Style(shape.di);
    return new DataPainter(shape, style, new LabelPainter(style.label));
  }

  it('draws a data store as a cylinder', async () => {
    expect((await painterOf('DataStoreReference_Customers')).data()).toContain('<ellipse');
  });

  it('draws a data object as a page with a fold', async () => {
    const svg = (await painterOf('DataObjectReference_Order')).data();
    expect(svg.match(/<path/g)).toHaveLength(2);
  });

  it('marks a collection and tells data input from data output', async () => {
    const path = '../packages/render/test/golden/fixtures/data.bpmn';
    expect((await painterOf('DataObjectReference_List', path)).data()).toContain('M3 2V12M7 2V12M11 2V12');
    expect((await painterOf('DataInput_In', path)).data()).toContain('fill="none" stroke="#22242a" stroke-width="1.2"');
    expect((await painterOf('DataOutput_Out', path)).data()).toContain('fill="#22242a" stroke="#22242a" stroke-width="1.2"');
  });

  it('draws an annotation as a bracket with its text at the left', async () => {
    const svg = (await painterOf('TextAnnotation_ATextAnnotationThatWrapsOverSeveralLines')).annotation();
    expect(svg).toContain('text-anchor="start"');
  });

  it('draws an empty annotation as a bracket alone', async () => {
    const path = '../packages/render/test/golden/fixtures/data.bpmn';
    expect((await painterOf('TextAnnotation_Empty', path)).annotation()).not.toContain('<text');
  });
});

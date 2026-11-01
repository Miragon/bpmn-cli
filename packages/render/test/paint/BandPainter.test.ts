import { describe, expect, it } from 'vitest';
import { BandPainter } from '../../src/paint/BandPainter.js';
import { LabelPainter } from '../../src/paint/LabelPainter.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('BandPainter', () => {
  async function painterOf(path: string, id: string): Promise<BandPainter> {
    const shape = await CorpusModel.shape(path, id);
    const style = new Style(shape.di);
    return new BandPainter(shape, style, new LabelPainter(style.label));
  }

  async function laneIn(path: string): Promise<string> {
    const plane = await CorpusModel.plane(path);
    return [...plane.shapes.values()].find((shape) => shape.kind === 'lane')?.id as string;
  }

  it('turns the name of a horizontal pool by 90 degrees beside a separator', async () => {
    const svg = (await painterOf('models/render/gallery.bpmn', 'Participant_RenderGallery')).pool();
    expect(svg).toContain('transform="rotate(-90');
    expect(svg).toContain('V');
  });

  it('centres the name of a black-box pool without a separator', async () => {
    const svg = (await painterOf('models/render/gallery.bpmn', 'Participant_Partner')).pool();
    expect(svg).not.toContain('rotate(-90');
    expect(svg).not.toContain('<path');
  });

  it('keeps the name of a vertical pool upright, above a separator', async () => {
    const plane = await CorpusModel.plane('models/incremental/vertical.bpmn');
    const pool = [...plane.shapes.values()].find((shape) => shape.kind === 'participant')?.id as string;
    const svg = (await painterOf('models/incremental/vertical.bpmn', pool)).pool();
    expect(svg).not.toContain('rotate(-90');
    expect(svg).toContain('H');
  });

  it('leaves a lane without colour transparent', async () => {
    const path = 'models/step1/lane-label.bpmn';
    expect((await painterOf(path, await laneIn(path))).lane()).toContain('fill="none"');
  });

  it('tints a coloured lane and draws the marker of a multi-instance pool', async () => {
    const path = '../packages/render/test/golden/fixtures/bands.bpmn';
    expect((await painterOf(path, 'Lane_Tinted')).lane()).toContain('fill-opacity="0.35"');
    expect((await painterOf(path, 'Participant_Many')).pool()).toContain('M3 2V12M7 2V12M11 2V12');
  });

  it('writes nothing for a pool and a lane without a name', async () => {
    const path = '../packages/render/test/golden/fixtures/bands.bpmn';
    expect((await painterOf(path, 'Lane_Tinted')).lane()).not.toContain('<tspan');
    expect((await painterOf(path, 'Participant_Many')).pool()).not.toContain('<tspan');
  });
});

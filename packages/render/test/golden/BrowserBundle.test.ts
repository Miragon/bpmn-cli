import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { DiagramRenderer } from '../../src/index.js';
import { CorpusModel } from './CorpusModel.js';

interface BundledPackage {
  DiagramRenderer: typeof DiagramRenderer;
  TextMetrics: { width(text: string): number };
}

describe('browser bundle', () => {
  const entry = `export { DiagramRenderer } from './src/index.ts'; export { TextMetrics } from './src/text/index.ts';`;

  async function bundle(): Promise<{ code: string; inputs: string[] }> {
    const { outputFiles, metafile } = await build({
      stdin: { contents: entry, resolveDir: new URL('../..', import.meta.url).pathname, loader: 'ts' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'BpmnRender',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    return { code: (outputFiles[0] as { text: string }).text, inputs: Object.keys(metafile.inputs) };
  }

  it('holds no Node builtin', async () => {
    const { code, inputs } = await bundle();
    expect(inputs.filter((input) => input.startsWith('node:') || input.includes('node-builtin'))).toEqual([]);
    expect(code).not.toMatch(/\brequire\(["']node:/);
  });

  it('draws the whole corpus in a realm without a Node global, byte for byte', async () => {
    const { code } = await bundle();
    const bundled = runInNewContext(`${code};BpmnRender`) as BundledPackage;
    const models = [...CorpusModel.paths('models'), ...CorpusModel.paths('layout')];
    let planes = 0;
    for (const model of models) {
      const xml = CorpusModel.xml(model);
      const inRealm = await bundled.DiagramRenderer.fromXml(xml);
      const inNode = await DiagramRenderer.fromXml(xml);
      for (const plane of inNode.planes.length ? inNode.planes : [undefined]) {
        const options = plane === undefined ? {} : { plane };
        expect(inRealm.svg(options).svg).toBe(inNode.svg(options).svg);
        planes++;
      }
    }
    expect(planes).toBeGreaterThanOrEqual(models.length);
    expect(bundled.TextMetrics.width('Order')).toBeCloseTo(30.672, 6);
  });
});

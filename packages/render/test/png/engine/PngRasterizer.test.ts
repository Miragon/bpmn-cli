import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DiagramRenderer } from '../../../src/DiagramRenderer.js';
import { PngRasterizer } from '../../../src/png/engine/PngRasterizer.js';
import { CorpusModel } from '../../golden/CorpusModel.js';

describe('PngRasterizer', () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
  const wasm = (): Uint8Array => new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));

  it('refuses a load of something that is no WebAssembly, then loads the real one', async () => {
    await expect(PngRasterizer.load({ wasm: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ code: 'E_RENDER' });
    await expect(PngRasterizer.load({ wasm: wasm() })).resolves.toBeInstanceOf(PngRasterizer);
  });

  it('rasterises a diagram to the same PNG bytes every time', async () => {
    const rasterizer = await PngRasterizer.load({ wasm: wasm() });
    const image = (await DiagramRenderer.fromXml(CorpusModel.xml('models/views/claims.bpmn'))).svg();
    const png = rasterizer.png(image);
    expect([...png.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(Buffer.from(rasterizer.png(image)).equals(Buffer.from(png))).toBe(true);
  });

  it('refuses text that is no SVG', async () => {
    const rasterizer = await PngRasterizer.load({ wasm: wasm() });
    expect(() => rasterizer.png({ svg: 'not svg' })).toThrowError(expect.objectContaining({ code: 'E_RENDER' }));
  });
});

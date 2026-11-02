import { describe, expect, it } from 'vitest';
import { NodePngRasterizer } from '../../../src/png/node/NodePngRasterizer.js';

describe('NodePngRasterizer', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';

  it('finds the wasm file itself in Node and rasterises', async () => {
    const rasterizer = await NodePngRasterizer.load();
    expect(rasterizer.png({ svg }).length).toBeGreaterThan(0);
  });

  it('takes the wasm a caller passes', async () => {
    await expect(NodePngRasterizer.load({ wasm: new Uint8Array() })).resolves.toBeInstanceOf(NodePngRasterizer);
  });
});

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PngRasterizer } from '../engine/PngRasterizer.js';

export class NodePngRasterizer {
  private static readonly WASM_FILE = '@resvg/resvg-wasm/index_bg.wasm';

  private constructor(private readonly rasterizer: PngRasterizer) {}

  static async load(options: { wasm?: Uint8Array | ArrayBuffer } = {}): Promise<NodePngRasterizer> {
    const wasm = options.wasm ?? new Uint8Array(await readFile(createRequire(import.meta.url).resolve(NodePngRasterizer.WASM_FILE)));
    return new NodePngRasterizer(await PngRasterizer.load({ wasm }));
  }

  png(image: { svg: string }): Uint8Array {
    return this.rasterizer.png(image);
  }
}

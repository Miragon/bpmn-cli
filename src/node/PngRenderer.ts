import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { RENDER_MAX_SIZE, type RenderOptions, type RenderProblem, type RenderTile } from '../render/types.js';
import { CliError } from '../shared/CliError.js';
import { DocRenderer } from '../render/DocRenderer.js';

export interface PngImage {
  png: Uint8Array;
  width: number;
  height: number;
  /** image-token estimate: width * height / 784, rounded */
  tokens: number;
  columns?: [number, number];
  /** a tile's band (1..) when the drawing is also split top to bottom */
  band?: number;
}

export interface PngRenderResult {
  images: PngImage[];
  scale: number;
  plane: string;
  planes: string[];
  notes: string[];
  problems: RenderProblem[];
  nodes?: string[];
}

interface ResvgImage {
  asPng(): Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  free(): void;
}

interface ResvgModule {
  initWasm(input: Uint8Array): Promise<void>;
  Resvg: new (svg: string, options?: Record<string, unknown>) => { render(): ResvgImage; free(): void };
}

/** named through a variable: the package ships no types for its "import" entry */
const RESVG = '@resvg/resvg-wasm';
const FONT = new URL('../../assets/fonts/Arimo-Regular-Latin.ttf', import.meta.url);

interface Engine {
  resvg: ResvgModule;
  font: Uint8Array;
}

/**
 * PNG images of a diagram: the core renderer's SVG rasterised by resvg (WebAssembly) with the
 * bundled Arimo font, metric-compatible with Arial. No system font is read, so an image looks
 * the same on every machine and the same SVG always gives the same PNG bytes.
 */
export class PngRenderer {
  /** loaded once per process; a failed load is retried on the next call */
  private static engine: Promise<Engine> | undefined;

  /** Any rasteriser failure, including a wasm trap, becomes E_RENDER, never an abort. */
  async render(xml: string, opts: RenderOptions = {}): Promise<PngRenderResult> {
    const drawn = await DocRenderer.renderXml(xml, { ...opts, maxSize: opts.maxSize ?? RENDER_MAX_SIZE });
    const images: PngImage[] = [];
    const parts: Array<Pick<RenderTile, 'svg' | 'columns' | 'band'>> = drawn.tiles ?? [{ svg: drawn.svg }];
    for (const part of parts) {
      const { png, width, height } = await this.rasterize(part.svg);
      images.push({ png, width, height, tokens: Math.round((width * height) / 784), ...(part.columns ? { columns: part.columns } : {}), ...(part.band ? { band: part.band } : {}) });
    }
    return { images, scale: drawn.scale, plane: drawn.plane, planes: drawn.planes, notes: drawn.notes, problems: drawn.problems, ...(drawn.nodes ? { nodes: drawn.nodes } : {}) };
  }

  async rasterize(svg: string, opts: { pixels?: boolean } = {}): Promise<{ png: Uint8Array; width: number; height: number; pixels?: Uint8Array }> {
    let loaded: Engine;
    try {
      loaded = await PngRenderer.loadEngine();
    } catch (err) {
      throw this.renderError('The PNG rasteriser (@resvg/resvg-wasm) could not be loaded', err);
    }
    let doc: { render(): ResvgImage; free(): void } | undefined;
    let image: ResvgImage | undefined;
    try {
      doc = new loaded.resvg.Resvg(svg, {
        fitTo: { mode: 'original' },
        font: { fontBuffers: [loaded.font], loadSystemFonts: false, defaultFontFamily: 'Arimo', sansSerifFamily: 'Arimo' },
      });
      image = doc.render();
      return { png: image.asPng(), width: image.width, height: image.height, ...(opts.pixels ? { pixels: image.pixels } : {}) };
    } catch (err) {
      throw this.renderError('The PNG rasteriser failed', err);
    } finally {
      for (const owner of [image, doc]) {
        try {
          owner?.free();
        } catch {
          // a trapped instance cannot free; the error above is what counts
        }
      }
    }
  }

  private renderError(message: string, cause: unknown): CliError {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new CliError('E_RENDER', `${message}: ${reason}`, 'io', {
      hint: 'Write the SVG instead (`--format svg`), or render a smaller part; report the file if it keeps failing.',
    });
  }

  private static loadEngine(): Promise<Engine> {
    PngRenderer.engine ??= (async () => {
      const resvg = (await import(RESVG)) as ResvgModule;
      const wasm = await readFile(createRequire(import.meta.url).resolve(`${RESVG}/index_bg.wasm`));
      await resvg.initWasm(new Uint8Array(wasm));
      return { resvg, font: new Uint8Array(await readFile(FONT)) };
    })().catch((err: unknown) => {
      PngRenderer.engine = undefined;
      throw err;
    });
    return PngRenderer.engine;
  }
}

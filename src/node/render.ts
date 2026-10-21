/**
 * PNG images of a diagram (Node only; `@miragon/bpmn-cli/node`): the SVG of
 * the core renderer (src/render/index.ts) rasterised by resvg compiled to
 * WebAssembly (@resvg/resvg-wasm, imported on the first call, like
 * bpmn-auto-layout) with the bundled Arimo font (assets/fonts, SIL OFL 1.1;
 * metric-compatible with Arial, so the SVG's line breaks hold). No system
 * font is read: an image looks the same on every machine.
 *
 *   renderPng(xml, opts) -> { images: [{ png, width, height, tokens }], scale, plane, planes, notes, problems, nodes? }
 *
 * CONTRACT
 *  - The options are renderSvg's (crops, highlights, numbered problems,
 *    tiles); `maxSize` defaults to RENDER_MAX_SIZE (2000 px on the long
 *    edge). `images` holds one image, or with tiles one per tile (left to
 *    right, band by band, with their `columns` / `band`); each image's size
 *    is its SVG's. problems / nodes / notes are renderSvg's.
 *  - Any failure of the rasteriser (the wasm module missing or failing to
 *    load, a trap inside it) is E_RENDER (exit 4), never a process abort:
 *    the wasm build traps where the native one would abort. The SVG has no
 *    content outside the image (renderSvg culls it), which is what made
 *    resvg panic in the prototype.
 *  - Deterministic: the same SVG gives the same PNG bytes.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { RENDER_MAX_SIZE, renderSvg, type RenderOptions, type RenderProblem, type RenderTile } from '../render/index.js';
import { CliError } from '../shared/errors.js';

export interface PngImage {
  png: Uint8Array;
  width: number;
  height: number;
  /** image-token estimate: width * height / 784, rounded */
  tokens: number;
  /** a tile: the plane's columns it spans (`show --layout` c<first>..c<last>) */
  columns?: [number, number];
  /** a tile: its band (1..) when the drawing is also split top to bottom */
  band?: number;
}

export interface PngRenderResult {
  images: PngImage[];
  /** the zoom factor used */
  scale: number;
  /** the element whose plane was drawn */
  plane: string;
  /** the other planes (element ids) */
  planes: string[];
  notes: string[];
  /** with `problems`: the problems listed, numbered like their badges */
  problems: RenderProblem[];
  /** with a crop: its flow nodes drawn */
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

/** the package, named through a variable: TypeScript does not resolve it (it ships no types for its "import" entry) */
const RESVG = '@resvg/resvg-wasm';
const FONT = new URL('../../assets/fonts/Arimo-Regular-Latin.ttf', import.meta.url);

let engine: Promise<{ resvg: ResvgModule; font: Uint8Array }> | undefined;

function renderError(message: string, cause: unknown): CliError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new CliError('E_RENDER', `${message}: ${reason}`, 'io', {
    hint: 'Write the SVG instead (`--format svg`), or render a smaller part; report the file if it keeps failing.',
  });
}

/** The wasm module and the font, loaded once per process (a failed load is retried on the next call). */
function loadEngine(): Promise<{ resvg: ResvgModule; font: Uint8Array }> {
  engine ??= (async () => {
    const resvg = (await import(RESVG)) as ResvgModule;
    const wasm = await readFile(createRequire(import.meta.url).resolve(`${RESVG}/index_bg.wasm`));
    await resvg.initWasm(new Uint8Array(wasm));
    return { resvg, font: new Uint8Array(await readFile(FONT)) };
  })().catch((err: unknown) => {
    engine = undefined;
    throw err;
  });
  return engine;
}

/** One SVG as PNG at its own size (internal; `pixels` returns the RGBA data too, for the tests). */
export async function rasterize(svg: string, opts: { pixels?: boolean } = {}): Promise<{ png: Uint8Array; width: number; height: number; pixels?: Uint8Array }> {
  let loaded: { resvg: ResvgModule; font: Uint8Array };
  try {
    loaded = await loadEngine();
  } catch (err) {
    throw renderError('The PNG rasteriser (@resvg/resvg-wasm) could not be loaded', err);
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
    throw renderError('The PNG rasteriser failed', err);
  } finally {
    for (const o of [image, doc]) {
      try {
        o?.free();
      } catch {
        // a trapped instance cannot free; the error above is what counts
      }
    }
  }
}

/** `bpmn render` (PNG): one plane of the document (or a part, or its tiles) as PNG images (see the module contract and renderSvg). */
export async function renderPng(xml: string, opts: RenderOptions = {}): Promise<PngRenderResult> {
  const drawn = await renderSvg(xml, { ...opts, maxSize: opts.maxSize ?? RENDER_MAX_SIZE });
  const images: PngImage[] = [];
  const parts: Array<Pick<RenderTile, 'svg' | 'columns' | 'band'>> = drawn.tiles ?? [{ svg: drawn.svg }];
  for (const part of parts) {
    const { png, width, height } = await rasterize(part.svg);
    images.push({ png, width, height, tokens: Math.round((width * height) / 784), ...(part.columns ? { columns: part.columns } : {}), ...(part.band ? { band: part.band } : {}) });
  }
  return { images, scale: drawn.scale, plane: drawn.plane, planes: drawn.planes, notes: drawn.notes, problems: drawn.problems, ...(drawn.nodes ? { nodes: drawn.nodes } : {}) };
}

import { RenderError } from '../../read/RenderError.js';
import { ArimoFont } from './ArimoFont.js';

export interface PngLoadOptions {
  wasm: Uint8Array | ArrayBuffer;
}

interface ResvgRendering {
  asPng(): Uint8Array;
  free(): void;
}

interface ResvgDocument {
  render(): ResvgRendering;
  free(): void;
}

interface ResvgModule {
  initWasm(input: Uint8Array | ArrayBuffer): Promise<void>;
  Resvg: new (svg: string, options: Record<string, unknown>) => ResvgDocument;
}

export class PngRasterizer {
  private static engine: Promise<PngRasterizer> | undefined;

  private constructor(
    private readonly resvg: ResvgModule,
    private readonly font: Uint8Array,
  ) {}

  static load(options: PngLoadOptions): Promise<PngRasterizer> {
    PngRasterizer.engine ??= PngRasterizer.started(options).catch((cause: unknown) => {
      PngRasterizer.engine = undefined;
      throw PngRasterizer.failure('The PNG rasteriser (@resvg/resvg-wasm) could not be loaded', cause);
    });
    return PngRasterizer.engine;
  }

  png(image: { svg: string }): Uint8Array {
    let document: ResvgDocument | undefined;
    let rendering: ResvgRendering | undefined;
    try {
      document = new this.resvg.Resvg(image.svg, this.renderOptions());
      rendering = document.render();
      return rendering.asPng();
    } catch (cause) {
      throw PngRasterizer.failure('The PNG rasteriser failed', cause);
    } finally {
      PngRasterizer.freed(rendering);
      PngRasterizer.freed(document);
    }
  }

  private static async started({ wasm }: PngLoadOptions): Promise<PngRasterizer> {
    const resvg = (await import('@resvg/resvg-wasm')) as ResvgModule;
    await resvg.initWasm(wasm);
    return new PngRasterizer(resvg, ArimoFont.bytes());
  }

  private static failure(message: string, cause: unknown): RenderError {
    return new RenderError('E_RENDER', `${message}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  private static freed(owner: { free(): void } | undefined): void {
    try {
      owner?.free();
    } catch {
      return;
    }
  }

  private renderOptions(): Record<string, unknown> {
    return {
      fitTo: { mode: 'original' },
      font: { fontBuffers: [this.font], loadSystemFonts: false, defaultFontFamily: ArimoFont.FAMILY, sansSerifFamily: ArimoFont.FAMILY },
    };
  }
}

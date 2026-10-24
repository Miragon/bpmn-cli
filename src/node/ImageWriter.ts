import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { renderSvg, type RenderOptions, type RenderProblem } from '../render/index.js';
import { ioError } from '../shared/utils/errors.js';
import { PngRenderer } from './PngRenderer.js';

export type ImageFormat = 'png' | 'svg';

/** One written image of a render (a tile: its columns / band). */
export interface ShotImage {
  out: string;
  width: number;
  height: number;
  tokens: number;
  columns?: [number, number];
  band?: number;
}

/** What `render` (and `--render` of a mutating command) wrote and found. */
export interface Shot {
  out: string;
  format: ImageFormat;
  width: number;
  height: number;
  tokens: number;
  scale: number;
  plane: string;
  planes: string[];
  notes: string[];
  problems: RenderProblem[];
  nodes?: string[];
  /** with tiles: every image written */
  images?: ShotImage[];
}

export class ImageWriter {
  constructor(private readonly stdout: { write(bytes: string | Uint8Array): unknown }) {}

  /**
   * Renders `xml` and writes the image: to `out`, to stdout (`-`), else to
   * bpmn-cli/<stem>.<format> in the temp directory; tiles get -1, -2, ...
   * before the extension.
   */
  async write(xml: string, opts: RenderOptions, format: ImageFormat, out: string | undefined, stem: string): Promise<Shot> {
    let parts: Array<{ bytes: string | Uint8Array; width: number; height: number; tokens: number; columns?: [number, number]; band?: number }>;
    let r: { scale: number; plane: string; planes: string[]; notes: string[]; problems: RenderProblem[]; nodes?: string[] };
    if (format === 'svg') {
      const svg = await renderSvg(xml, opts);
      parts = (svg.tiles ?? [svg]).map((t) => ({ bytes: t.svg, width: t.width, height: t.height, tokens: t.tokens, ...('columns' in t && t.columns ? { columns: t.columns } : {}), ...('band' in t && t.band ? { band: t.band } : {}) }));
      r = svg;
    } else {
      const png = await new PngRenderer().render(xml, opts);
      parts = png.images.map((i) => ({ bytes: i.png, width: i.width, height: i.height, tokens: i.tokens, ...(i.columns ? { columns: i.columns } : {}), ...(i.band ? { band: i.band } : {}) }));
      r = png;
    }
    const images: ShotImage[] = [];
    if (out === '-') {
      this.stdout.write(parts[0]!.bytes);
      images.push({ out: '-', width: parts[0]!.width, height: parts[0]!.height, tokens: parts[0]!.tokens });
    } else {
      const target = out ?? join(tmpdir(), 'bpmn-cli', `${stem}.${format}`);
      const ext = extname(target);
      for (const [i, p] of parts.entries()) {
        const file = parts.length > 1 ? `${target.slice(0, target.length - ext.length)}-${i + 1}${ext}` : target;
        try {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, p.bytes);
        } catch (err) {
          throw ioError('E_IO', `Cannot write ${file}: ${(err as Error).message}`, { file, hint: 'Pass -o <file> in a writable directory.' });
        }
        images.push({ out: file, width: p.width, height: p.height, tokens: p.tokens, ...(p.columns ? { columns: p.columns } : {}), ...(p.band ? { band: p.band } : {}) });
      }
    }
    const first = images[0]!;
    return {
      out: first.out,
      format,
      width: first.width,
      height: first.height,
      tokens: first.tokens,
      scale: r.scale,
      plane: r.plane,
      planes: r.planes,
      notes: r.notes,
      problems: r.problems,
      ...(r.nodes ? { nodes: r.nodes } : {}),
      ...(images.length > 1 ? { images } : {}),
    };
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { ioError } from '../../../domain/document/utils/errors.js';
import { PngRenderer } from './PngRenderer.js';
import type { ImageRequest, WriteImagePort, Shot, ShotImage } from '../../../application/port/out/WriteImagePort.js';

export class FileImageWriter implements WriteImagePort {
  /**
   * Writes to `out`, stdout (`-`) or the temp directory's bpmn-cli/<stem>.<format>;
   * tiles get -1, -2, ... before the extension.
   */
  async write({ drawn, format, out, stem, stdout }: ImageRequest): Promise<Shot> {
    let parts: Array<{ bytes: string | Uint8Array; width: number; height: number; tokens: number; columns?: [number, number]; band?: number }>;
    if (format === 'svg') {
      parts = (drawn.tiles ?? [drawn]).map((tile) => ({ bytes: tile.svg, width: tile.width, height: tile.height, tokens: tile.tokens, ...('columns' in tile && tile.columns ? { columns: tile.columns } : {}), ...('band' in tile && tile.band ? { band: tile.band } : {}) }));
    } else {
      const png = await new PngRenderer().render(drawn);
      parts = png.images.map((image) => ({ bytes: image.png, width: image.width, height: image.height, tokens: image.tokens, ...(image.columns ? { columns: image.columns } : {}), ...(image.band ? { band: image.band } : {}) }));
    }
    const images: ShotImage[] = [];
    if (out === '-') {
      stdout.write(parts[0]!.bytes);
      images.push({ out: '-', width: parts[0]!.width, height: parts[0]!.height, tokens: parts[0]!.tokens });
    } else {
      const target = out ?? join(tmpdir(), 'bpmn-cli', `${stem}.${format}`);
      const ext = extname(target);
      for (const [partIndex, part] of parts.entries()) {
        const file = parts.length > 1 ? `${target.slice(0, target.length - ext.length)}-${partIndex + 1}${ext}` : target;
        try {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, part.bytes);
        } catch (err) {
          throw ioError('E_IO', `Cannot write ${file}: ${(err as Error).message}`, { file, hint: 'Pass -o <file> in a writable directory.' });
        }
        images.push({ out: file, width: part.width, height: part.height, tokens: part.tokens, ...(part.columns ? { columns: part.columns } : {}), ...(part.band ? { band: part.band } : {}) });
      }
    }
    const first = images[0]!;
    return {
      out: first.out,
      format,
      width: first.width,
      height: first.height,
      tokens: first.tokens,
      scale: drawn.scale,
      plane: drawn.plane,
      planes: drawn.planes,
      notes: drawn.notes,
      problems: drawn.problems,
      ...(drawn.nodes ? { nodes: drawn.nodes } : {}),
      ...(images.length > 1 ? { images } : {}),
    };
  }
}

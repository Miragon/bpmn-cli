import type { Shot } from '../node/ImageWriter.js';
import { AROUND_DEFAULT_DEPTH } from '../query/context.js';
import { scaleText, type RenderHighlight, type RenderOptions } from '../render/index.js';
import type { CliError } from '../shared/CliError.js';

/** The text of a render: what `bpmn render` and `--render` of a mutating command print about the image(s) written. */
export class RenderReport {
  constructor(private readonly shot: Shot) {}

  /** `bpmn render`: the image lines, the crop, the --highlight halos and the numbered problems the options asked for. */
  renderLines(opts: RenderOptions): string[] {
    const crop = this.cropOf(opts);
    return this.lines({ ...(crop ? { crop } : {}), ...(Array.isArray(opts.highlight) && opts.highlight.length ? { halos: 'orange --highlight' } : {}), ...(opts.problems ? { problems: 'problems' } : {}) });
  }

  /** `--render <file>` of a mutating command: the first line as `render: ...`, the rest indented below it. */
  resultLines(highlight: RenderHighlight): string[] {
    const halos = this.haloLegend(highlight);
    const lines = this.lines({ ...(halos ? { halos } : {}), problems: 'layout problems the change added' });
    return [`render: ${lines[0]!}`, ...lines.slice(1).map((l) => `  ${l}`)];
  }

  /** A failed `--render <file>`: the mutation stands, the line says why there is no image. */
  static failureLine(err: CliError): string {
    return `render: failed ${err.code}: ${err.message}${err.details.hint ? `  (${String(err.details.hint)})` : ''}`;
  }

  /** One `wrote` line per image, then the crop, the halos, the numbered problems, the planes and the notes. */
  private lines(extra: { crop?: string; halos?: string; problems?: string }): string[] {
    const shot = this.shot;
    const images = shot.images ?? [{ out: shot.out, width: shot.width, height: shot.height, tokens: shot.tokens }];
    const lines = images.map((im, i) => {
      const tile = images.length > 1 ? `  tile ${i + 1}/${images.length}${im.columns ? ` c${im.columns[0]}-c${im.columns[1]}` : ''}${im.band ? ` band ${im.band}` : ''}` : '';
      return `wrote ${im.out === '-' ? '<stdout>' : im.out}  ${im.width}x${im.height} px  ~${this.thousands(im.tokens)} image tokens  scale ${scaleText(shot.scale)}  plane ${shot.plane}${tile}`;
    });
    if (images.length > 1) lines.push(`${images.length} tiles, ~${this.thousands(images.reduce((s, im) => s + im.tokens, 0))} image tokens in all`);
    if (extra.crop) lines.push(`crop: ${extra.crop}: ${shot.nodes?.length ?? 0} node${shot.nodes?.length === 1 ? '' : 's'}`);
    if (extra.halos) lines.push(`halos: ${extra.halos}`);
    if (extra.problems !== undefined) {
      if (!shot.problems.length) lines.push(`${extra.problems}: none`);
      else {
        lines.push(`${extra.problems} (numbered in the image):`);
        for (const p of shot.problems) {
          const where = !p.drawn ? '  (not in the image)' : p.tile ? `  (tile ${p.tile})` : '';
          lines.push(`  ${p.n} ${p.kind} [${p.ids.join(', ')}]${p.detail ? ` ${p.detail}` : ''}${where}`);
        }
      }
    }
    if (shot.planes.length) lines.push(`other planes (--plane <id>): ${shot.planes.join(', ')}`);
    for (const note of shot.notes) lines.push(`note: ${note}`);
    return lines;
  }

  /** The crop of `bpmn render`, as the result names it (one per call). */
  private cropOf(opts: RenderOptions): string | undefined {
    if (opts.around) return `around ${opts.around.id} (depth ${opts.around.depth ?? AROUND_DEFAULT_DEPTH}${opts.around.inner ? ', inner' : ''})`;
    if (opts.path) return `path ${opts.path.from} -> ${opts.path.to}${opts.path.via ? ` via ${opts.path.via.join(', ')}` : ''}`;
    if (opts.scope !== undefined) return `scope ${opts.scope}`;
    if (opts.ids?.length) return `${opts.ids.length} id${opts.ids.length > 1 ? 's' : ''}`;
    return undefined;
  }

  /** The halo legend of a highlight: the colour names of HALO_COLORS. */
  private haloLegend(h: RenderHighlight): string | undefined {
    const names: Record<keyof RenderHighlight, string> = { created: 'green', changed: 'orange', moved: 'blue' };
    const parts = (['created', 'changed', 'moved'] as const).filter((k) => h[k]?.length).map((k) => `${names[k]} ${k}`);
    return parts.length ? parts.join(', ') : undefined;
  }

  /** Thousands with commas (1,856). */
  private thousands(v: number): string {
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

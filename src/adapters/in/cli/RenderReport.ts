import type { Shot } from '../../../application/port/out/WriteImagePort.js';
import { AROUND_DEFAULT_DEPTH } from '../../../domain/views/context.js';
import type { RenderHighlight, RenderOptions } from '../../../domain/views/render/types.js';
import { scaleText } from '../../../domain/views/utils/scale.js';
import type { CliError } from '../../../domain/document/CliError.js';

export class RenderReport {
  constructor(private readonly shot: Shot) {}

  renderLines(opts: RenderOptions): string[] {
    const crop = this.cropOf(opts);
    return this.lines({ ...(crop ? { crop } : {}), ...(Array.isArray(opts.highlight) && opts.highlight.length ? { halos: 'orange --highlight' } : {}), ...(opts.problems ? { problems: 'problems' } : {}) });
  }

  resultLines(highlight: RenderHighlight): string[] {
    const halos = this.haloLegend(highlight);
    const lines = this.lines({ ...(halos ? { halos } : {}), problems: 'layout problems the change added' });
    return [`render: ${lines[0]!}`, ...lines.slice(1).map((line) => `  ${line}`)];
  }

  static failureLine(err: CliError): string {
    return `render: failed ${err.code}: ${err.message}${err.details.hint ? `  (${String(err.details.hint)})` : ''}`;
  }

  private lines(extra: { crop?: string; halos?: string; problems?: string }): string[] {
    const shot = this.shot;
    const images = shot.images ?? [{ out: shot.out, width: shot.width, height: shot.height, tokens: shot.tokens }];
    const lines = images.map((im, tileIndex) => {
      const tile = images.length > 1 ? `  tile ${tileIndex + 1}/${images.length}${im.columns ? ` c${im.columns[0]}-c${im.columns[1]}` : ''}${im.band ? ` band ${im.band}` : ''}` : '';
      return `wrote ${im.out === '-' ? '<stdout>' : im.out}  ${im.width}x${im.height} px  ~${this.thousands(im.tokens)} image tokens  scale ${scaleText(shot.scale)}  plane ${shot.plane}${tile}`;
    });
    if (images.length > 1) lines.push(`${images.length} tiles, ~${this.thousands(images.reduce((total, im) => total + im.tokens, 0))} image tokens in all`);
    if (extra.crop) lines.push(`crop: ${extra.crop}: ${shot.nodes?.length ?? 0} node${shot.nodes?.length === 1 ? '' : 's'}`);
    if (extra.halos) lines.push(`halos: ${extra.halos}`);
    if (extra.problems !== undefined) {
      if (!shot.problems.length) lines.push(`${extra.problems}: none`);
      else {
        lines.push(`${extra.problems} (numbered in the image):`);
        for (const problem of shot.problems) {
          const where = !problem.drawn ? '  (not in the image)' : problem.tile ? `  (tile ${problem.tile})` : '';
          lines.push(`  ${problem.n} ${problem.kind} [${problem.ids.join(', ')}]${problem.detail ? ` ${problem.detail}` : ''}${where}`);
        }
      }
    }
    if (shot.planes.length) lines.push(`other planes (--plane <id>): ${shot.planes.join(', ')}`);
    for (const note of shot.notes) lines.push(`note: ${note}`);
    return lines;
  }

  private cropOf(opts: RenderOptions): string | undefined {
    if (opts.around) return `around ${opts.around.id} (depth ${opts.around.depth ?? AROUND_DEFAULT_DEPTH}${opts.around.inner ? ', inner' : ''})`;
    if (opts.path) return `path ${opts.path.from} -> ${opts.path.to}${opts.path.via ? ` via ${opts.path.via.join(', ')}` : ''}`;
    if (opts.scope !== undefined) return `scope ${opts.scope}`;
    if (opts.ids?.length) return `${opts.ids.length} id${opts.ids.length > 1 ? 's' : ''}`;
    return undefined;
  }

  private haloLegend(highlight: RenderHighlight): string | undefined {
    const names: Record<keyof RenderHighlight, string> = { created: 'green', changed: 'orange', moved: 'blue' };
    const parts = (['created', 'changed', 'moved'] as const).filter((change) => highlight[change]?.length).map((change) => `${names[change]} ${change}`);
    return parts.length ? parts.join(', ') : undefined;
  }

  private thousands(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

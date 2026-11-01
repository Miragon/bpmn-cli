import type { DiagramNote, RenderedImage, RenderOptions } from '../../api/index.js';

export class ImageText {
  private static readonly PIXELS_PER_TOKEN = 784;
  private static readonly NOTES: Readonly<Record<DiagramNote['kind'], (ids: string) => string>> = {
    'no-diagram': () => 'the file has no diagram: drawn in memory, nothing written (`bpmn layout <file>` draws it into the file)',
    undrawn: (ids) => `no shape, not drawn: ${ids} (\`bpmn layout <file>\` draws them)`,
    'broken-coordinates': (ids) => `broken coordinates, not drawn: ${ids} (\`bpmn layout <file>\` draws them again)`,
    'broken-labels': (ids) => `broken label bounds, not drawn: ${ids} (\`bpmn label <file> <id> --side below\` places each again)`,
    'empty-plane': (ids) => `the plane of ${ids} is empty`,
    'fit-on-other-plane': (ids) => `on another plane, not in the image: ${ids}`,
    'fit-not-drawn': (ids) => `not drawn: ${ids}`,
  };

  constructor(
    private readonly image: RenderedImage,
    private readonly target: string,
  ) {}

  private static thousands(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  static tokensOf({ width, height }: Pick<RenderedImage, 'width' | 'height'>): number {
    return Math.ceil((width * height) / ImageText.PIXELS_PER_TOKEN);
  }

  lines(options: RenderOptions): string[] {
    return [this.wroteLine(), ...this.cropLines(options), ...(options.problems ? this.problemLines() : []), ...this.image.notes.map(ImageText.noteLine)];
  }

  private static noteLine({ kind, ids }: DiagramNote): string {
    return `note: ${ImageText.NOTES[kind](ids.join(', '))}`;
  }

  private wroteLine(): string {
    const { width, height, scale, plane } = this.image;
    const shownScale = (Math.floor(scale * 100 + 1e-9) / 100).toFixed(2);
    return `wrote ${this.target === '-' ? '<stdout>' : this.target}  ${width}x${height} px  ~${ImageText.thousands(ImageText.tokensOf(this.image))} image tokens  scale ${shownScale}  plane ${plane ?? 'none'}`;
  }

  private cropLines({ around, path, ids }: RenderOptions): string[] {
    const nodes = this.image.drawn.length;
    const counted = `${nodes} element${nodes === 1 ? '' : 's'}`;
    if (around !== undefined) {
      return [`crop: around ${around} (depth ${this.image.depth}): ${counted}`];
    }
    if (path) {
      return [`crop: path ${path[0]} -> ${path[1]}: ${counted}`];
    }
    return ids?.length ? [`crop: ${ids.length} id${ids.length > 1 ? 's' : ''}: ${counted}`] : [];
  }

  private problemLines(): string[] {
    const problems = this.image.problems ?? [];
    if (!problems.length) {
      return ['problems: none'];
    }
    return ['problems (numbered in the image):', ...problems.map(({ n, kind, ids, detail, drawn }) => `  ${n} ${kind} [${ids.join(', ')}]${detail ? ` ${detail}` : ''}${drawn ? '' : '  (not in the image)'}`)];
  }
}

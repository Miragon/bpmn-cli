import { Svg, type SceneItem } from '../paint/index.js';
import { Box, type Plane } from '../read/index.js';
import { type Badge, BadgeLayer, type PlacedBadge } from './BadgeLayer.js';

export interface SizeOptions {
  scale?: number;
  maxSize?: number;
  badges?: readonly Badge[];
}

export interface Composition {
  svg: string;
  width: number;
  height: number;
  scale: number;
  badges: number[];
}

export class SvgComposer {
  private static readonly MARGIN = 20;
  private static readonly FONT = 'Arial, Arimo, sans-serif';

  constructor(
    private readonly items: readonly SceneItem[],
    private readonly plane: Plane | undefined,
    private readonly options: SizeOptions,
  ) {}

  composition(): Composition {
    const view = this.view();
    const scale = this.scaleFor(view);
    const placed = this.plane ? new BadgeLayer(this.plane, view, scale).placed(this.options.badges ?? []) : [];
    const width = Math.max(1, Math.round(view.width * scale));
    const height = Math.max(1, Math.round(view.height * scale));
    return { svg: this.markup(view, width, height, placed), width, height, scale: Math.round(scale * 10000) / 10000, badges: placed.map((badge) => badge.n) };
  }

  private view(): Box {
    const fitted = this.items.filter((item) => !item.context);
    const content = Box.around((fitted.length ? fitted : this.items).map((item) => item.fitted ?? item.box));
    return (content ?? new Box(0, 0, 0, 0)).grown(SvgComposer.MARGIN);
  }

  private scaleFor(view: Box): number {
    const { scale, maxSize } = this.options;
    const asked = scale !== undefined && scale > 0 && Number.isFinite(scale) ? scale : 1;
    const longest = Math.max(view.width, view.height);
    return maxSize && maxSize > 0 && longest * asked > maxSize ? maxSize / longest : asked;
  }

  private markup(view: Box, width: number, height: number, badges: PlacedBadge[]): string {
    const layered = this.items.map((item, index) => ({ item, index }));
    const visible = layered
      .filter(({ item }) => item.box.meets(view))
      .sort((first, second) => first.item.layer - second.item.layer || first.index - second.index)
      .map(({ item }) => item.svg);
    const body = [...visible, ...badges.filter((badge) => badge.box.meets(view)).map((badge) => badge.svg)];
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${Svg.number(view.x)} ${Svg.number(view.y)} ${Svg.number(view.width)} ${Svg.number(view.height)}" font-family="${SvgComposer.FONT}">\n` +
      `<rect ${Svg.box(view)} fill="${Svg.FILL}"/>\n` +
      body.join('\n') +
      (body.length ? '\n' : '') +
      '</svg>\n'
    );
  }
}

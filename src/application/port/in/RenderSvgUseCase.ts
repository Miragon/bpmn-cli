import type { Doc } from '../../../domain/document/Doc.js';
import type { LayoutProblem, MetricKey } from '../../../domain/diagram/utils/problems.js';

/** The CLI's `--render` colours created, changed and moved elements apart. */
export interface RenderHighlight {
  /** green */
  created?: string[];
  /** orange: the model or a colour changed */
  changed?: string[];
  /** blue: placed, moved or rerouted by the layout */
  moved?: string[];
}

/** Options of renderSvg / renderDocSvg / renderPng; at most one crop option. */
export interface RenderOptions {
  /** a collapsed sub-process, process or collaboration; default: the first diagram or the crop's */
  plane?: string;
  scale?: number;
  /** longest edge in px; a larger image is scaled down to it */
  maxSize?: number;
  /** crop: exactly the flow nodes of `show --around` */
  around?: { id: string; depth?: number; inner?: boolean };
  /** crop: the shortest sequence-flow path */
  path?: { from: string; to: string; via?: string[] };
  /** crop: a pool, lane or sub-process with what is drawn inside it */
  scope?: string;
  ids?: string[];
  /** their plane, cut to the region around them when the whole would be unreadable */
  focus?: string[];
  highlight?: string[] | RenderHighlight;
  /** numbered badges: true = every layout problem, or exactly these */
  problems?: boolean | readonly LayoutProblem[];
  /** split an unreadable image into tiles at the diagram's columns */
  tiles?: boolean;
}

export interface RenderProblem {
  n: number;
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** false: on another plane, outside the crop, or nowhere to draw */
  drawn: boolean;
  tile?: number;
}

export interface RenderTile {
  svg: string;
  width: number;
  height: number;
  tokens: number;
  /** the plane's columns it spans; absent when it holds no flow node */
  columns?: [number, number];
  band?: number;
}

export interface RenderResult {
  /** with tiles: svg, width, height and tokens are the first tile's */
  svg: string;
  width: number;
  height: number;
  /** below `scale` when maxSize capped it */
  scale: number;
  /** width * height / 784, rounded */
  tokens: number;
  plane: string;
  /** the other planes: what `plane` can name */
  planes: string[];
  notes: string[];
  problems: RenderProblem[];
  /** with a crop: its flow nodes drawn */
  nodes?: string[];
  tiles?: RenderTile[];
}

/** What Claude Code displays. */
export const RENDER_MAX_SIZE = 2000;
/** Below this scale the 11-12 px labels drop under ~8 px and are hard to read. */
export const MIN_LABEL_SCALE = 0.75;
/** A plain highlight list uses `changed`. */
export const HALO_COLORS = { created: '#2f9e44', changed: '#f76707', moved: '#1c7ed6' } as const;

/** `bpmn render --format svg` in memory: one plane of a document as SVG, nothing written. */
export interface RenderSvgUseCase {

  renderXml(command: RenderSvgUseCase.XmlCommand): Promise<RenderResult>;

  /** One plane of a parsed document (no layout). */
  renderDoc(command: RenderSvgUseCase.DocCommand): RenderResult;
}

export declare namespace RenderSvgUseCase {

  /** The XML text to draw as SVG. */
  interface XmlCommand extends RenderOptions {
    xml: string;
  }

  /** A parsed document to draw as SVG. */
  interface DocCommand extends RenderOptions {
    doc: Doc;
  }
}

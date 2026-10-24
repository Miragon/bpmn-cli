import type { Box } from '../diagram/utils/geom.js';
import type { LayoutProblem, MetricKey } from '../diagram/utils/problems.js';
import type { Plane } from '../diagram/types.js';
import type { El } from '../model/utils/moddle.js';

/** What a halo marks: the CLI's `--render` colours created, changed and moved elements apart. */
export interface RenderHighlight {
  /** elements the change created: green */
  created?: string[];
  /** elements whose model (or colour) changed: orange */
  changed?: string[];
  /** elements the layout placed, moved or rerouted: blue */
  moved?: string[];
}

/** Options of renderSvg / renderDocSvg / renderPng (see the module contract). */
export interface RenderOptions {
  /** the element whose plane to draw: a collapsed sub-process, the process or the collaboration (default: the first diagram, or the crop's) */
  plane?: string;
  /** zoom factor of the image (default 1) */
  scale?: number;
  /** longest edge of the image in px: a larger image is scaled down to it (default: no limit; renderPng: RENDER_MAX_SIZE) */
  maxSize?: number;
  /** crop: exactly the flow nodes of `show --around <id> --depth <n> [--inner]` */
  around?: { id: string; depth?: number; inner?: boolean };
  /** crop: the nodes and flows of the shortest sequence-flow path (`--path <from> <to> [--via <flow...>]`) */
  path?: { from: string; to: string; via?: string[] };
  /** crop: a pool, lane or sub-process with what is drawn inside it */
  scope?: string;
  /** crop: exactly these elements */
  ids?: string[];
  /** keep these readable: their plane, and only the region around them when the whole plane would be drawn below MIN_LABEL_SCALE */
  focus?: string[];
  /** a halo around these elements (a list: one colour) */
  highlight?: string[] | RenderHighlight;
  /** numbered badges: true = every layout problem (`bpmn metrics`), or exactly these problems */
  problems?: boolean | readonly LayoutProblem[];
  /** split an image that would be unreadable into tiles at the diagram's columns */
  tiles?: boolean;
}

/** A layout problem as listed by a render: numbered like its badge. */
export interface RenderProblem {
  /** the number of its badge (1..) */
  n: number;
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** its badge is in the image (false: on another plane, outside the crop, or nowhere to draw: missing, failed) */
  drawn: boolean;
  /** with tiles: the tile (1..) its badge is in */
  tile?: number;
}

/** One image of a render split into tiles. */
export interface RenderTile {
  svg: string;
  width: number;
  height: number;
  tokens: number;
  /** the plane's columns the tile spans (`show --layout` c<first>..c<last>); absent when it holds no flow node */
  columns?: [number, number];
  /** the band (1..) when the drawing is also split top to bottom */
  band?: number;
}

export interface RenderResult {
  /** the SVG document (with tiles: the first tile) */
  svg: string;
  /** image size in px (after scale / maxSize; with tiles: the first tile's) */
  width: number;
  height: number;
  /** the zoom factor used (below `scale` when maxSize capped it) */
  scale: number;
  /** image-token estimate of the image: width * height / 784, rounded (with tiles: the first tile's) */
  tokens: number;
  /** the element whose plane was drawn */
  plane: string;
  /** the other planes (their element ids, document order): what `plane` can name */
  planes: string[];
  /** labels below MIN_LABEL_SCALE, elements without a shape, an in-memory layout, crop elements on other planes, the focus region, tiles */
  notes: string[];
  /** with `problems`: the problems listed, numbered like their badges */
  problems: RenderProblem[];
  /** with a crop: its flow nodes drawn (around: exactly show --around's nodes on this plane) */
  nodes?: string[];
  /** with `tiles`, when the image needed them: every tile */
  tiles?: RenderTile[];
}

/** The long edge `bpmn render` and renderPng cap an image at by default (what Claude Code displays). */
export const RENDER_MAX_SIZE = 2000;
/** Below this scale the 11-12 px labels drop under ~8 px and are hard to read: the result says so. */
export const MIN_LABEL_SCALE = 0.75;
/** The halo colours: a plain highlight list uses `changed`. */
export const HALO_COLORS = { created: '#2f9e44', changed: '#f76707', moved: '#1c7ed6' } as const;
/** --tiles makes at most this many tiles: a drawing that needs more stays one image, with a note (render a part instead). */
export const MAX_TILES = 40;
/** Coordinates beyond ±COORD_LIMIT px (or not a number) are broken DI: such a shape, connection or label is not drawn, a note names it. */
export const COORD_LIMIT = 1_000_000;

export const MARGIN = 20;

export interface Item {
  /** what it covers (culling and the view) */
  box: Box;
  /** paint order: lower first */
  layer: number;
  svg: string;
  /** the element it draws (shapes, connections, labels, halos) */
  id?: string;
  /** context (a crop's frames) and overlays: drawn when in view, but the view is not made to fit them */
  extra?: boolean;
  /** what the view fits instead of `box` (a faded connection: its first 40 px) */
  fit?: Box;
  /** a badge: only in this tile */
  tile?: number;
  /** what makes a tile worth keeping: a shape's box, a label's, a frame's name; absent for connections, context and overlays */
  content?: Box;
}

/* layers: frames from outside in, then leaves, groups, boundary events, connections, labels, badges */
export const LAYER = { participant: 0, lane: 1, subProcess: 2, leaf: 3, group: 4, boundary: 5, edge: 6, label: 7, badge: 8 } as const;

export interface Frame {
  plane: string;
  planes: string[];
  notes: string[];
  /** the plane drawn (badges are placed on it) */
  located?: Plane;
  defs?: El;
  /** a file drawn in memory: its own layout problems (listed instead of the drawing's; no badges) */
  fileProblems?: LayoutProblem[];
  /** a crop's ids drawn in full */
  drawn?: Set<string>;
  nodes?: string[];
}

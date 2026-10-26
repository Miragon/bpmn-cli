import type { RenderOptions, RenderProblem } from '../../../domain/views/render/types.js';

export type ImageFormat = 'png' | 'svg';

export interface ShotImage {

  out: string;
  width: number;
  height: number;
  tokens: number;
  columns?: [number, number];
  band?: number;
}

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
  images?: ShotImage[];
}

export interface ImageRequest {

  xml: string;
  opts: RenderOptions;
  format: ImageFormat;

  /**
   * a file, `-` for stdout,
   * or undefined for the temp directory's bpmn-cli/<stem>.<format>
   */
  out: string | undefined;

  stem: string;
  stdout: { write(bytes: string | Uint8Array): unknown };
}

/** Renders a document as PNG or SVG and writes it to a file or stdout (`-`). */
export interface WriteImagePort {

  write(request: ImageRequest): Promise<Shot>;
}

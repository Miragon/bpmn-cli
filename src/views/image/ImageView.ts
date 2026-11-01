import type { Badge, DiagramNote, DiagramNoteKind, DiagramRenderer, SvgImage } from '@miragon/bpmn-render';
import { DiagramDrawing, DrawingSnapshot } from '../../drawing/index.js';
import { BpmnError, ChangeSet, type BpmnDocument } from '../../model/index.js';
import { DrawnPlane, ElementHomes, ProblemLocator, Scorer, type LayoutProblem } from '../../scoring/index.js';
import { ImageCrop, type CropOptions } from './ImageCrop.js';

export type { DiagramNote, DiagramNoteKind, SvgImage };

export interface RenderOptions extends CropOptions {
  problems?: boolean | undefined;
}

export interface NumberedProblem extends Omit<LayoutProblem, 'at'> {
  n: number;
  drawn: boolean;
}

export interface RenderedImage extends SvgImage {
  problems?: NumberedProblem[] | undefined;
  depth?: number | undefined;
}

export class ImageView {
  private static readonly HINT = '`bpmn layout <file>` draws the elements without a shape; `bpmn diagram <file>` lists what is drawn.';

  constructor(
    private readonly document: BpmnDocument,
    private readonly options: RenderOptions = {},
  ) {}

  private static numbered(problems: readonly LayoutProblem[], badges: readonly number[]): NumberedProblem[] {
    return problems.map(({ at: _at, ...problem }, index) => ({ ...problem, n: index + 1, drawn: badges.includes(index + 1) }));
  }

  private static badgesOn(plane: string | undefined, problems: readonly LayoutProblem[]): Badge[] {
    return problems.flatMap(({ ids, at }, index) => (at && at.plane === plane ? [{ n: index + 1, ids, at: { x: at.x, y: at.y } }] : []));
  }

  async answer(): Promise<RenderedImage> {
    const { DiagramRenderer, RenderError } = await import('@miragon/bpmn-render');
    const problems = this.options.problems ? new Scorer().scoreDrawing(DrawnPlane.read(this.document), new ElementHomes(this.document)).problems : undefined;
    const isDrawn = this.document.diagram.planes().length > 0;
    if (!isDrawn) {
      await new DiagramDrawing(this.document).update(DrawingSnapshot.of(this.document), new ChangeSet(), [{ op: 'layout' }]);
    }
    try {
      const renderer = DiagramRenderer.fromDefinitions(this.document.tree.definitions.raw);
      const image = this.badged(renderer, problems, isDrawn);
      return isDrawn ? image : { ...image, notes: [{ kind: 'no-diagram', ids: [] }, ...image.notes] };
    } catch (error) {
      throw error instanceof RenderError ? BpmnError.model(error.code, error.message, { element: error.element, hint: ImageView.HINT }) : error;
    }
  }

  private badged(renderer: DiagramRenderer, problems: readonly LayoutProblem[] | undefined, isDrawn: boolean): RenderedImage {
    const { depth, ...crop } = new ImageCrop(this.document).of(this.options);
    const image = renderer.svg(crop);
    if (!problems) {
      return { ...image, depth };
    }
    const located = isDrawn ? new ProblemLocator(this.document).locate(problems) : problems;
    const listed = crop.fit ? located.filter(({ ids }) => ids.some((id) => image.drawn.includes(id))) : located;
    const badges = ImageView.badgesOn(image.plane, listed);
    const badged = badges.length ? renderer.svg({ ...crop, badges }) : image;
    return { ...badged, depth, problems: ImageView.numbered(listed, badged.badges) };
  }
}

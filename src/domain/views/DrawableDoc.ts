import { Doc } from '../document/Doc.js';
import { FullLayout } from '../diagram/layout/FullLayout.js';
import { LayoutAnalysis } from '../diagram/di/LayoutAnalysis.js';
import type { LayoutProblem } from '../diagram/utils/problems.js';
import { DiagramReader } from '../diagram/di/DiagramReader.js';

/** A document ready to draw: one without any diagram is laid out in memory first; its problems stay the file's. */
export class DrawableDoc {
  private constructor(
    readonly doc: Doc,
    readonly notes: string[],
    readonly fileProblems?: LayoutProblem[],
  ) {}

  static async fromXml(xml: string, withProblems: boolean): Promise<DrawableDoc> {
    const doc = await Doc.fromXml(xml);
    if (new DiagramReader(doc.definitions).planes().length) return new DrawableDoc(doc, []);
    const fileProblems = withProblems ? LayoutAnalysis.of(doc.definitions).problems : [];
    const { xml: drawn } = await new FullLayout(doc.model).run();
    const notes = ['the file has no diagram: it is drawn by the layout engine in memory (nothing is written; `bpmn layout <file>` saves a drawing)'];
    if (withProblems) notes.push("the problems are the file's (`bpmn metrics <file>`), not the in-memory drawing's: none is in the image");
    return new DrawableDoc(await Doc.fromXml(drawn), notes, fileProblems);
  }
}

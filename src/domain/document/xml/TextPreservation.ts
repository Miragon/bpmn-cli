import { parseXml } from '../utils/moddle.js';
import { PreservingWriter } from './PreservingWriter.js';
import { readXmlText, type XDocument } from '../utils/text-reader.js';
import { firstLine } from '../utils/text.js';

export interface PreservedText {
  xml: string;
  mode: 'unchanged' | 'preserved' | 'plain';
  droppedComments: number;
  reason?: string;
}

/**
 * Rewrites only the elements a change changed. An element whose bpmn-moddle text is equal
 * before and after the change keeps its text from the original file. The result must read
 * back as the changed model, else it is bpmn-moddle's plain serialisation.
 */
export class TextPreservation {
  constructor(
    private readonly original: string,
    private readonly baseline: string,
    private readonly next: string,
  ) {}

  /** Tries the original order of children first, bpmn-moddle's when that does not read back. */
  async result(): Promise<PreservedText> {
    const { original, baseline, next } = this;
    if (next === baseline) return { xml: original, mode: 'unchanged', droppedComments: 0 };
    let docs: [XDocument, XDocument, XDocument];
    try {
      docs = [readXmlText(original), readXmlText(baseline), readXmlText(next)];
    } catch (err) {
      return this.plain(firstLine(err));
    }
    let reason = '';
    for (const keepOrder of [true, false]) {
      let xml: string;
      let kept: number;
      try {
        xml = new PreservingWriter(...docs, keepOrder).write();
        kept = readXmlText(xml).comments;
      } catch (err) {
        reason = firstLine(err);
        continue;
      }
      if (xml === original) return { xml, mode: 'unchanged', droppedComments: 0 };
      if (await this.readsAs(xml)) return { xml, mode: 'preserved', droppedComments: Math.max(0, docs[0].comments - kept) };
      reason = 'the preserved text does not read back as the changed model';
    }
    return this.plain(reason);
  }

  plain(reason: string): PreservedText {
    return { xml: this.next, mode: 'plain', droppedComments: this.roughCommentCount(), reason };
  }

  private roughCommentCount(): number {
    return this.original.split('<!--').length - 1;
  }

  /**
   * Whether `xml` reads back as `next`, read like Doc.fromXml (references with whitespace around
   * the id resolve). `next` is normally a fixed point of read + write; else its round trip counts.
   */
  private async readsAs(xml: string): Promise<boolean> {
    const write = async (text: string): Promise<string | undefined> => {
      try {
        const { moddle, definitions } = await parseXml(text);
        return (await moddle.toXML(definitions, { format: true })).xml;
      } catch {
        return undefined;
      }
    };
    const written = await write(xml);
    if (written === undefined) return false;
    return written === this.next || written === (await write(this.next));
  }
}

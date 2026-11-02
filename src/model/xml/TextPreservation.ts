import { BpmnError } from '../errors/BpmnError.js';
import { ModdleParser } from './ModdleParser.js';
import { PreservingWriter } from './PreservingWriter.js';
import { XmlTextReader, type XDocument } from './XmlTextReader.js';

export interface PreservedText {
  xml: string;
  mode: 'unchanged' | 'preserved' | 'plain';
  droppedComments: number;
  reason?: string;
}

export class TextPreservation {
  constructor(
    private readonly original: string,
    private readonly baseline: string,
    private readonly next: string,
  ) {}

  async result(): Promise<PreservedText> {
    const { original, baseline, next } = this;
    if (next === baseline) {
      return { xml: original, mode: 'unchanged', droppedComments: 0 };
    }
    let docs: [XDocument, XDocument, XDocument];
    try {
      docs = [XmlTextReader.read(original), XmlTextReader.read(baseline), XmlTextReader.read(next)];
    } catch (err) {
      return this.plain(BpmnError.firstLine(err));
    }
    let reason = '';
    for (const keepOrder of [true, false]) {
      let xml: string;
      let kept: number;
      try {
        xml = new PreservingWriter(...docs, keepOrder).write();
        kept = XmlTextReader.read(xml).comments;
      } catch (err) {
        reason = BpmnError.firstLine(err);
        continue;
      }
      if (xml === original) {
        return { xml, mode: 'unchanged', droppedComments: 0 };
      }
      if (await this.readsAs(xml)) {
        return { xml, mode: 'preserved', droppedComments: Math.max(0, docs[0].comments - kept) };
      }
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

  private async readsAs(xml: string): Promise<boolean> {
    const write = async (text: string): Promise<string | undefined> => {
      try {
        const { moddle, definitions } = await new ModdleParser().parse(text);
        return (await moddle.toXML(definitions, { format: true })).xml;
      } catch {
        return undefined;
      }
    };
    const written = await write(xml);
    if (written === undefined) {
      return false;
    }
    return written === this.next || written === (await write(this.next));
  }
}

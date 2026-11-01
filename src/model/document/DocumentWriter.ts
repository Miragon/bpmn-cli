import { BpmnError } from '../errors/BpmnError.js';
import { TextPreservation } from '../xml/TextPreservation.js';
import { XmlEncoding } from '../xml/XmlEncoding.js';
import type { BpmnDocument, DocumentSource } from './BpmnDocument.js';
import type { ChangeSet } from './ChangeSet.js';
import { MirrorLists } from './MirrorLists.js';

export class DocumentWriter {
  async plain(document: BpmnDocument): Promise<string> {
    const { moddle, definitions } = document.tree;
    const { xml } = await moddle.toXML(definitions.raw, { format: true });
    return xml;
  }

  async asRead(document: BpmnDocument): Promise<string | undefined> {
    return document.source ? this.withoutUnkeptEntries(document, document.source) : undefined;
  }

  async write(document: BpmnDocument, changes?: ChangeSet): Promise<string> {
    const { source } = document;
    if (!source) {
      return this.plain(document);
    }
    if (source.asRead === undefined) {
      throw new BpmnError('E_INTERNAL', 'A document is written only after DocumentReader.readForWrite', 'internal');
    }
    const next = await this.withoutUnkeptEntries(document, source);
    const preservation = new TextPreservation(source.text, source.asRead, next);
    const text = document.lossyImportWarnings.length ? preservation.plain('the import was lossy') : await preservation.result();
    if (text.mode === 'plain') {
      const comments = text.droppedComments ? `; ${text.droppedComments} XML comment(s) dropped` : '';
      changes?.note(`the file's formatting was not kept (${text.reason}): written as bpmn-moddle serialises it${comments}`);
    } else if (text.droppedComments) {
      changes?.note(`${text.droppedComments} XML comment(s) dropped: they were inside or next to elements the change removed or rewrote`);
    }
    if (text.xml === source.text) {
      return text.xml;
    }
    const declared = XmlEncoding.utf8Declaration(text.xml);
    if (declared.was !== undefined) {
      changes?.note(`the XML declaration named the encoding ${declared.was}; the text is written as UTF-8, so it now says UTF-8`);
    }
    return declared.text;
  }

  private withoutUnkeptEntries(document: BpmnDocument, source: DocumentSource): Promise<string> {
    const mirror = new MirrorLists(document.tree.definitions);
    return mirror.without(mirror.unkept(source.mirror), () => this.plain(document));
  }
}

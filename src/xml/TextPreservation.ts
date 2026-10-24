/**
 * Text-preserving output: a change rewrites only the elements it changed.
 *
 * bpmn-moddle serialises a whole model in its own style: namespace
 * declarations and vendor attributes in its order, entities instead of CDATA,
 * no comments, two-space indentation. Written as is, every edit would rewrite
 * large parts of a file that was saved by another tool (or by hand), and a
 * host that stores BPMN in git or syncs one text region (design-iq) would see
 * churn far away from the edit.
 *
 * TextPreservation compares three texts:
 *
 *  - `original`: the file as read;
 *  - `baseline`: bpmn-moddle's serialisation of the model as read;
 *  - `next`: bpmn-moddle's serialisation of the model after the change.
 *
 * `baseline` and `next` are written in the same style, so an element whose
 * text is identical in both is unchanged by the edit, whatever bpmn-moddle
 * normalised; its text is copied from `original` (attribute order, quoting,
 * entities, CDATA, comments, whitespace and indentation inside it included).
 * The elements of the three texts are paired top-down: by `id` among siblings,
 * the others by name and position (between baseline and next also by equal
 * text). A changed element keeps its start tag from `original` when its
 * attributes did not change, otherwise the original attribute order with the
 * changed values, new attributes after the attribute bpmn-moddle writes them
 * after; its children follow bpmn-moddle's order, each with the whitespace and
 * comments written before it, and new children get the file's indentation
 * (unit, line break and `/>` style detected from the original). A text-only
 * element whose content changed keeps a CDATA section when the original used
 * one. The prolog (XML declaration, comments before the root) and everything
 * after the root element are kept.
 *
 * Comments next to an element the change removed (or inside it) are dropped;
 * the result counts them (`droppedComments`) so the caller can say so.
 *
 * Safety: the result must read back, with bpmn-moddle, as exactly the model
 * `next` describes (parsed and serialised again, it must equal `next`) and be
 * well-formed for the reader in xml/utils/text-reader.ts. If not, or if anything is
 * ambiguous or unsupported (a DOCTYPE, differing root elements), the result
 * is `next` itself (`mode: 'plain'` with a reason).
 */
import { parseXml } from '../model/utils/moddle.js';
import { PreservingWriter } from './PreservingWriter.js';
import { readXmlText, type XDocument } from './utils/text-reader.js';
import { firstLine } from '../shared/utils/text.js';

export interface PreservedText {
  xml: string;
  /**
   * `unchanged`: the change left the model as read, `xml` is the original
   * text; `preserved`: unchanged parts were copied from the original;
   * `plain`: bpmn-moddle's serialisation (see `reason`).
   */
  mode: 'unchanged' | 'preserved' | 'plain';
  /** comments of the original text that the result no longer has */
  droppedComments: number;
  /** why the plain serialisation was written */
  reason?: string;
}

export class TextPreservation {
  constructor(
    private readonly original: string,
    private readonly baseline: string,
    private readonly next: string,
  ) {}

  /** See the module header. */
  async result(): Promise<PreservedText> {
    const { original, baseline, next } = this;
    if (next === baseline) return { xml: original, mode: 'unchanged', droppedComments: 0 };
    let docs: [XDocument, XDocument, XDocument];
    try {
      docs = [readXmlText(original), readXmlText(baseline), readXmlText(next)];
    } catch (err) {
      return this.plain(firstLine(err));
    }
    // the original order of children first; bpmn-moddle's order when that does not read back as the same model
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

  /** The plain serialisation `next` as the result, counting the comments of `original` it drops. */
  plain(reason: string): PreservedText {
    return { xml: this.next, mode: 'plain', droppedComments: this.roughCommentCount(), reason };
  }

  /** Comments in the original text, without parsing it (for a text the reader cannot read). */
  private roughCommentCount(): number {
    return this.original.split('<!--').length - 1;
  }

  /** Whether bpmn-moddle reads `xml` as the model `next` was serialised from. */
  private async readsAs(xml: string): Promise<boolean> {
    const write = async (text: string): Promise<string | undefined> => {
      try {
        // read like Doc.fromXml reads (model/utils/moddle.ts parseXml: references with whitespace around the id resolve)
        const { moddle, definitions } = await parseXml(text);
        return (await moddle.toXML(definitions, { format: true })).xml;
      } catch {
        return undefined;
      }
    };
    const written = await write(xml);
    if (written === undefined) return false;
    // `next` is normally a fixed point of read + write; compare with its own round trip when it is not
    return written === this.next || written === (await write(this.next));
  }
}

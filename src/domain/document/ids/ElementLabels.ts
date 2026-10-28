import { kindOf, triggerOf } from '../Kinds.js';
import { is, type El } from '../utils/moddle.js';
import { hasIdWords, nameWords } from '../utils/slug.js';
import { CONTEXT_WORDS, kindWord, localName, speakingStem, stemWords, ucfirst, type ContextWord } from '../utils/id-words.js';
import { connectionRequest, type IdRequest } from '../utils/requests.js';

export interface AnchorContext {
  context: string;
  anchorKind?: string;
}

/**
 * How other ids name an element (flow ends, owners), so that ids are built from ids.
 */
export class ElementLabels {
  private readonly own: string | undefined;

  constructor(private readonly el: El) {
    const id = el.get<string | undefined>('id');
    this.own = id ? speakingStem(id) : undefined;
  }

  static flowRequest(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source: El, target: El, name?: string): IdRequest {
    return connectionRequest(type, source.get<string>('id'), target.get<string>('id'), { ...(name ? { name } : {}), sourceLabel: new ElementLabels(source).label(), targetLabel: new ElementLabels(target).label() });
  }

  /**
   * The speaking part of its id (stable across renames); for an id that says too little
   * (a hash, a number, Part_B) its name, a text annotation's text, else a kind word.
   */
  label(): string {
    const name = this.el.get<string | undefined>('name');
    const own = this.own;
    const named = hasIdWords(name);
    if (is(this.el, 'bpmn:TextAnnotation')) {
      const text = this.el.get<string | undefined>('text');
      return own ?? (nameWords(text).length ? text! : 'TextAnnotation');
    }
    if (own && (!named || own.replace(/[^A-Za-z]/g, '').length >= 3)) return named ? own : (this.joinLabel(own) ?? own);
    if (named) return name!;
    return this.kindLabel();
  }

  /**
   * The context the element gives an unnamed neighbour (`After Check invoice`). An unnamed anchor
   * placed the same way passes on its own anchor once (`After Check`, never `After AfterCheck`).
   */
  context(word: ContextWord): string {
    return this.anchorContext(word).context;
  }

  /**
   * context, plus the anchor's kind word where it passes on its own context (`Gateway`),
   * so a new id that would repeat the anchor's body can be told apart. An anchor labelled only by
   * its own name gets its kind word in the context (Check Join).
   */
  anchorContext(word: ContextWord): AnchorContext {
    const label = this.label();
    const own = this.own;
    if (!own || is(this.el, 'bpmn:TextAnnotation') || hasIdWords(this.el.get<string | undefined>('name'))) return { context: `${word} ${label}` };
    const parts = this.contextParts(own);
    if (!parts) return { context: `${word} ${label}` };
    if (parts.word === word && (word === 'After' || word === 'Before')) return { context: `${word} ${parts.tail.join(' ')}`, anchorKind: this.kindLabel() };
    if (!parts.head.length && label === own) return { context: `${word} ${this.kindLabel()} ${label}` };
    return { context: `${word} ${label}` };
  }

  /**
   * The labels earlier versions gave the element as a flow end, so flows named by them
   * are still recognised: an unnamed element with a context id was named by its kind.
   */
  formerLabels(): string[] {
    const own = this.own;
    if (!own || hasIdWords(this.el.get<string | undefined>('name')) || is(this.el, 'bpmn:TextAnnotation') || !this.contextParts(own)) return [];
    return [kindOf(this.el)?.family === 'gateway' && /join$/i.test(own) ? 'Join' : this.kindLabel()];
  }

  private kindLabel(): string {
    const el = this.el;
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) return 'Flow';
    const def = kindOf(el);
    if (def?.family === 'gateway') return 'Gateway';
    if (def) return kindWord(def.kind, triggerOf(el));
    return localName(el.$type);
  }

  /**
   * An unnamed join named after its split (Gateway_AfterCheck_join -> `Check Join`;
   * Gateway_InvoiceOk_join keeps `InvoiceOk_join`).
   */
  private joinLabel(own: string): string | undefined {
    const match = /^(.+?)_?join$/i.exec(own);
    if (!match) return undefined;
    const parts = this.contextParts(match[1]!);
    return parts && !parts.head.length && parts.word === 'After' ? `${parts.tail.join(' ')} Join` : undefined;
  }

  /**
   * Splits a kind-and-context body (`EndAfterTimer`) at the first context word within its first
   * three words; a collision suffix is not part of the anchor.
   */
  private contextParts(stem: string): { head: string[]; word: ContextWord; tail: string[] } | undefined {
    const words = stemWords(stem.replace(/_\d+$/, ''));
    const contextIndex = words.slice(0, 3).findIndex((word) => CONTEXT_WORDS.has(word.toLowerCase()));
    if (contextIndex === -1 || contextIndex === words.length - 1) return undefined;
    return { head: words.slice(0, contextIndex), word: ucfirst(words[contextIndex]!.toLowerCase()) as ContextWord, tail: words.slice(contextIndex + 1) };
  }
}

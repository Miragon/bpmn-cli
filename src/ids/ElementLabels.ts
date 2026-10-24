import { kindOf, triggerOf } from '../model/utils/kinds.js';
import { is, type El } from '../model/utils/moddle.js';
import { hasIdWords, nameWords } from './utils/slug.js';
import { CONTEXT_WORDS, kindWord, localName, speakingStem, stemWords, ucfirst, type ContextWord } from './utils/id-words.js';
import { connectionRequest, type IdRequest } from './utils/requests.js';

/** The context of an unnamed element (context) and, where it repeats an unnamed anchor's own context, a word for that anchor's kind (IdRequest.anchorKind). */
export interface AnchorContext {
  context: string;
  anchorKind?: string;
}

export class ElementLabels {
  private readonly own: string | undefined;

  constructor(private readonly el: El) {
    const id = el.get<string | undefined>('id');
    this.own = id ? speakingStem(id) : undefined;
  }

  /** The request for a connection between two elements: their ids and speaking labels (label). */
  static flowRequest(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source: El, target: El, name?: string): IdRequest {
    return connectionRequest(type, source.get<string>('id'), target.get<string>('id'), { ...(name ? { name } : {}), sourceLabel: new ElementLabels(source).label(), targetLabel: new ElementLabels(target).label() });
  }

  /**
   * How another id names the element (the ends of a flow, what an element
   * belongs to), so that ids are built from ids: the speaking part of its id
   * (Activity_CheckInvoice -> CheckInvoice, also after a rename of the
   * element; an unnamed element's own context, Gateway_AfterCheckInvoice ->
   * AfterCheckInvoice, so the flows at two unnamed gateways differ; the join
   * of the split after Check -> `Check Join`); else, for an id that says too
   * little (a hash, a number, one or two letters such as Part_B), its name; a
   * text annotation its text; else a word for its kind (Gateway, End, Timer,
   * UserTask, Flow, ...).
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
   * The context the element gives an unnamed element as its anchor (`After
   * Check invoice`, `On Review`, `In Payment`): `<word> <label>`, but an
   * anchor that is itself unnamed and placed the same way gives its own
   * anchor (the nearest named anchor, once: after Gateway_AfterCheck is
   * `After Check`, never `After AfterCheck`), and an unnamed anchor whose id
   * starts with its context says its kind first (`On Task AfterCheck`).
   */
  context(word: ContextWord): string {
    return this.anchorContext(word).context;
  }

  /**
   * context with the kind of the anchor it names past: after or before an
   * unnamed anchor placed the same way (Gateway_AfterCheck) the context is the
   * anchor's own (`After Check`), and `anchorKind` (`Gateway`) tells the new
   * element apart where its id would repeat the anchor's body
   * (Task_AfterCheckGateway after ExclusiveGateway_AfterCheck in a file whose
   * task prefix says the kind; IdStyle.next).
   */
  anchorContext(word: ContextWord): AnchorContext {
    const label = this.label();
    const own = this.own;
    if (!own || is(this.el, 'bpmn:TextAnnotation') || hasIdWords(this.el.get<string | undefined>('name'))) return { context: `${word} ${label}` };
    const parts = this.contextParts(own);
    if (!parts) return { context: `${word} ${label}` };
    if (parts.word === word && (word === 'After' || word === 'Before')) return { context: `${word} ${parts.tail.join(' ')}`, anchorKind: this.kindLabel() };
    // the join's label says its kind (Check Join)
    if (!parts.head.length && label === own) return { context: `${word} ${this.kindLabel()} ${label}` };
    return { context: `${word} ${label}` };
  }

  /**
   * The labels earlier versions gave the element as a flow end (FlowIdFollower.follow
   * recognises a flow named by them): an unnamed element whose id tells its
   * context was named by its kind (Gateway, Join, End, Timer).
   */
  formerLabels(): string[] {
    const own = this.own;
    if (!own || hasIdWords(this.el.get<string | undefined>('name')) || is(this.el, 'bpmn:TextAnnotation') || !this.contextParts(own)) return [];
    return [kindOf(this.el)?.family === 'gateway' && /join$/i.test(own) ? 'Join' : this.kindLabel()];
  }

  /** A word for the kind of an element without a speaking id or name (Gateway, End, Timer, UserTask, Flow, ...). */
  private kindLabel(): string {
    const el = this.el;
    if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) return 'Flow';
    const def = kindOf(el);
    if (def?.family === 'gateway') return 'Gateway';
    if (def) return kindWord(def.kind, triggerOf(el));
    return localName(el.$type);
  }

  /**
   * The label of an unnamed join a split gave its gateway's id (`<id>_join`,
   * `<id>Join`): the split's anchor and Join (Gateway_AfterCheck_join ->
   * `Check Join`; Gateway_InvoiceOk_join keeps `InvoiceOk_join`).
   */
  private joinLabel(own: string): string | undefined {
    const m = /^(.+?)_?join$/i.exec(own);
    if (!m) return undefined;
    const parts = this.contextParts(m[1]!);
    return parts && !parts.head.length && parts.word === 'After' ? `${parts.tail.join(' ')} Join` : undefined;
  }

  /**
   * An id body made from a kind and a context (`AfterCheckInvoice`,
   * `EndAfterTimer`, `timer_on_review`): the words before the first context
   * word among its first three words (the kind: `End`, none for a gateway or
   * task), that word and the words after it (the anchor); a collision suffix
   * is not part of the anchor. Undefined for any other stem.
   */
  private contextParts(stem: string): { head: string[]; word: ContextWord; tail: string[] } | undefined {
    const words = stemWords(stem.replace(/_\d+$/, ''));
    const i = words.slice(0, 3).findIndex((w) => CONTEXT_WORDS.has(w.toLowerCase()));
    if (i === -1 || i === words.length - 1) return undefined;
    return { head: words.slice(0, i), word: ucfirst(words[i]!.toLowerCase()) as ContextWord, tail: words.slice(i + 1) };
  }
}

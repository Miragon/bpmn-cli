import type { BpmnElement } from '../document/BpmnElement.js';
import { IdRequests, type IdRequest } from '../ids/IdRequests.js';
import { IdSlug } from '../ids/IdSlug.js';
import { IdWords, type ContextWord } from '../ids/IdWords.js';
import { Kinds } from './Kinds.js';
import { Triggers } from './Triggers.js';

export interface AnchorContext {
  context: string;
  anchorKind?: string;
}

export class ElementLabels {
  private readonly own: string | undefined;

  constructor(private readonly el: BpmnElement) {
    const id = el.get<string | undefined>('id');
    this.own = id ? IdWords.speakingStem(id) : undefined;
  }

  static flowRequest(type: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow', source: BpmnElement, target: BpmnElement, name?: string): IdRequest {
    return IdRequests.connectionRequest(type, source.get<string>('id'), target.get<string>('id'), { ...(name ? { name } : {}), sourceLabel: new ElementLabels(source).label(), targetLabel: new ElementLabels(target).label() });
  }

  label(): string {
    const name = this.el.get<string | undefined>('name');
    const own = this.own;
    const named = IdSlug.hasIdWords(name);
    if (this.el.is('bpmn:TextAnnotation')) {
      const text = this.el.get<string | undefined>('text');
      return own ?? (IdSlug.nameWords(text).length ? text! : 'TextAnnotation');
    }
    if (own && (!named || own.replace(/[^A-Za-z]/g, '').length >= 3)) {
      return named ? own : (this.joinLabel(own) ?? own);
    }
    if (named) {
      return name!;
    }
    return this.kindLabel();
  }

  context(word: ContextWord): string {
    return this.anchorContext(word).context;
  }

  anchorContext(word: ContextWord): AnchorContext {
    const label = this.label();
    const own = this.own;
    if (!own || this.el.is('bpmn:TextAnnotation') || IdSlug.hasIdWords(this.el.get<string | undefined>('name'))) {
      return { context: `${word} ${label}` };
    }
    const parts = this.contextParts(own);
    if (!parts) {
      return { context: `${word} ${label}` };
    }
    if (parts.word === word && (word === 'After' || word === 'Before')) {
      return { context: `${word} ${parts.tail.join(' ')}`, anchorKind: this.kindLabel() };
    }
    if (!parts.head.length && label === own) {
      return { context: `${word} ${this.kindLabel()} ${label}` };
    }
    return { context: `${word} ${label}` };
  }

  formerLabels(): string[] {
    const own = this.own;
    if (!own || IdSlug.hasIdWords(this.el.get<string | undefined>('name')) || this.el.is('bpmn:TextAnnotation') || !this.contextParts(own)) {
      return [];
    }
    return [Kinds.of(this.el)?.family === 'gateway' && /join$/i.test(own) ? 'Join' : this.kindLabel()];
  }

  private kindLabel(): string {
    const el = this.el;
    if (el.is('bpmn:SequenceFlow') || el.is('bpmn:MessageFlow')) {
      return 'Flow';
    }
    const def = Kinds.of(el);
    if (def?.family === 'gateway') {
      return 'Gateway';
    }
    if (def) {
      return IdWords.kindWord(def.kind, Triggers.of(el));
    }
    return IdWords.localName(el.type);
  }

  private joinLabel(own: string): string | undefined {
    const match = /^(.+?)_?join$/i.exec(own);
    if (!match) {
      return undefined;
    }
    const parts = this.contextParts(match[1]!);
    return parts && !parts.head.length && parts.word === 'After' ? `${parts.tail.join(' ')} Join` : undefined;
  }

  private contextParts(stem: string): { head: string[]; word: ContextWord; tail: string[] } | undefined {
    const words = IdWords.stemWords(stem.replace(/_\d+$/, ''));
    const contextIndex = words.slice(0, 3).findIndex((word) => IdWords.CONTEXT_WORDS.has(word.toLowerCase()));
    if (contextIndex === -1 || contextIndex === words.length - 1) {
      return undefined;
    }
    return { head: words.slice(0, contextIndex), word: IdWords.ucfirst(words[contextIndex]!.toLowerCase()) as ContextWord, tail: words.slice(contextIndex + 1) };
  }
}

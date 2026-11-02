import { IdSlug } from './IdSlug.js';

export type ContextWord = 'After' | 'Before' | 'On' | 'In';

export class IdWords {
  static readonly PREFIXED = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/;
  static readonly CONTEXT_WORDS = new Set(['after', 'before', 'on', 'in']);
  private static readonly GLUED = /^([A-Za-z]+)(\d+)$/;
  private static readonly TOOL_DEFAULTS = new Set(['StartEvent_1']);
  private static readonly HASH = /^[01][0-9a-z]{6}$/;

  static lcfirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  static ucfirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static localName(type: string): string {
    return type.slice(type.indexOf(':') + 1);
  }

  static caseLike(name: string, lowerFirst: boolean): string {
    return (lowerFirst ? IdWords.lcfirst(name) : IdWords.ucfirst(name));
  }

  static speakingStem(id: string): string | undefined {
    if (IdWords.TOOL_DEFAULTS.has(id) || IdWords.GLUED.test(id)) {
      return undefined;
    }
    const suffixed = /^(.+)_(\d+)$/.exec(id);
    if (suffixed && (suffixed[1]!.includes('_') || IdSlug.nameWords(suffixed[1]).length > 1)) {
      const base = IdWords.speakingStem(suffixed[1]!);
      return base ? `${base}_${suffixed[2]}` : undefined;
    }
    const idStem = IdWords.stem(id);
    if (IdWords.HASH.test(idStem) || /^\d+$/.test(idStem) || !/[A-Za-z]/.test(idStem)) {
      return undefined;
    }
    const digits = idStem.replace(/[^0-9]/g, '').length;
    if (digits >= 3 && digits * 4 >= idStem.length && !IdWords.hasWord(idStem)) {
      return undefined;
    }
    return idStem;
  }

  static stemWords(stem: string): string[] {
    return stem
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .replace(/([A-Za-z])([0-9])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  static beginAlike(one: string, other: string): boolean {
    const first = (slug: string): string => (IdWords.stemWords(slug)[0] ?? '').toLowerCase();
    return first(one) === first(other);
  }

  static kindWord(key: string, trigger: string | undefined, withContext = false): string {
    const triggerWord = trigger && trigger !== 'none' ? IdWords.ucfirst(trigger) : '';
    switch (key) {
      case 'startEvent':
        return `${triggerWord}Start`;
      case 'endEvent':
        return `${triggerWord}End`;
      case 'boundaryEvent':
        return triggerWord || 'Boundary';
      case 'intermediateCatchEvent':
        return triggerWord || 'Catch';
      case 'intermediateThrowEvent':
        return triggerWord ? `${triggerWord}Throw` : 'Intermediate';
    }
    if (withContext) {
      return '';
    }
    if (/^[a-z]+Gateway$/.test(key)) {
      return IdWords.ucfirst(key.slice(0, -'Gateway'.length));
    }
    if (key === 'bpmn:Process' || key === 'bpmn:Collaboration' || key === 'bpmn:Definitions') {
      return 'Main';
    }
    return IdWords.ucfirst(IdWords.localName(key));
  }

  private static stem(id: string): string {
    const underscoreIndex = id.indexOf('_');
    return underscoreIndex === -1 ? id : id.slice(underscoreIndex + 1);
  }

  private static hasWord(text: string): boolean {
    return (text.match(/[A-Za-z]{4,}/g) ?? []).some((run) => /[g-z]/i.test(run));
  }
}

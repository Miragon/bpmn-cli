import { Phrase } from './Phrase.js';

export interface ElementRef {
  id: string;
  kind: string;
  name?: string | undefined;
}

export interface FlagSource {
  lane?: ElementRef | undefined;
  trigger?: string | undefined;
  nonInterrupting?: boolean | undefined;
  expanded?: boolean | undefined;
  props?: Record<string, unknown> | undefined;
  documentation?: string | undefined;
}

export interface VendorFacts {
  attrs?: Record<string, string> | undefined;
  extensionElements?: string[] | undefined;
}

export class ElementLine {
  static readonly INDENT = '  ';

  private static readonly DOCUMENTATION_MAX = 80;

  constructor(private readonly element: Pick<ElementRef, 'id' | 'name'> & Partial<ElementRef>) {}

  static scalar(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    const isTextList = Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    return isTextList ? value.join(', ') : JSON.stringify(value);
  }

  static flagsOf(source: FlagSource, { leading = [], afterState = [], vendor = [] }: { leading?: string[]; afterState?: string[]; vendor?: string[] }): string[] {
    const flags = [...leading];
    if (source.lane) {
      flags.push(`lane=${source.lane.id}`);
    }
    if (source.trigger) {
      flags.push(source.trigger);
    }
    if (source.nonInterrupting) {
      flags.push('non-interrupting');
    }
    if (source.expanded !== undefined) {
      flags.push(source.expanded ? 'expanded' : 'collapsed');
    }
    flags.push(...afterState, ...Object.entries(source.props ?? {}).map(([key, value]) => `${key}=${ElementLine.scalar(value)}`), ...vendor);
    if (source.documentation) {
      flags.push(`doc: ${new Phrase(source.documentation).cutQuoted(ElementLine.DOCUMENTATION_MAX)}`);
    }
    return flags;
  }

  static vendorFlags({ attrs, extensionElements }: VendorFacts): string[] {
    const flags = Object.entries(attrs ?? {}).map(([key, value]) => `${key}=${new Phrase(value).flag()}`);
    return extensionElements?.length ? [...flags, `ext: ${ElementLine.counted(extensionElements)}`] : flags;
  }

  private static counted(types: readonly string[]): string {
    const counts = new Map<string, number>();
    for (const type of types) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts].map(([type, count]) => (count > 1 ? `${type} x${count}` : type)).join(', ');
  }

  get named(): string {
    const { id, name } = this.element;
    return name ? `${id} ${new Phrase(name).quoted}` : id;
  }

  get ref(): string {
    return `${this.element.kind} ${this.named}`;
  }

  flagged(flags: readonly string[]): string {
    return `${this.ref}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  }
}

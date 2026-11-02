import { ElementLine } from './ElementLine.js';
import { Phrase } from './Phrase.js';

export interface ExtensionFacts {
  type: string;
  attrs: Record<string, string>;
  body?: string | undefined;
  children?: ExtensionFacts[] | undefined;
}

export class ExtensionLine {
  private static readonly IO_TYPES = /(^|:)(inputOutput|ioMapping)$/;
  private static readonly INPUTS = ['inputParameter', 'input'];
  private static readonly OUTPUTS = ['outputParameter', 'output'];

  constructor(private readonly extension: ExtensionFacts) {}

  private static localName(type: string): string {
    return type.split(':')[1] ?? type;
  }

  private static bodyBlock(body: string): string[] | undefined {
    const lines = body.replace(/\r\n?/g, '\n').replace(/^(\s*\n)+/, '').trimEnd().split('\n');
    return lines.length > 1 ? lines.map((line) => line.trimEnd()) : undefined;
  }

  private static mapping({ attrs, body }: ExtensionFacts): string {
    return `${attrs['name'] ?? attrs['target'] ?? '?'}=${body?.trim() ?? attrs['source'] ?? ''}`;
  }

  lines(lead = '', indent = ''): string[] {
    return this.ioLine(lead, indent) ?? this.block(lead, indent);
  }

  private ioLine(lead: string, indent: string): string[] | undefined {
    const { type, children = [] } = this.extension;
    const isFlat = children.every((child) => !child.children?.length && ExtensionLine.bodyBlock(child.body ?? '') === undefined);
    if (!ExtensionLine.IO_TYPES.test(type) || !isFlat || !children.length) {
      return undefined;
    }
    const side = (word: string, locals: string[]): string[] => {
      const mappings = children.filter((child) => locals.includes(ExtensionLine.localName(child.type))).map(ExtensionLine.mapping);
      return mappings.length ? [`${word} ${mappings.join(', ')}`] : [];
    };
    return [`${indent}${lead}${[type, ...side('in', ExtensionLine.INPUTS), ...side('out', ExtensionLine.OUTPUTS)].join('  ')}`];
  }

  private block(lead: string, indent: string): string[] {
    const { type, attrs, body, children = [] } = this.extension;
    const parts = [type, ...Object.entries(attrs).map(([key, value]) => `${key}=${new Phrase(value).quoted}`)];
    const inner = `${indent}${' '.repeat(lead.length)}${ElementLine.INDENT}`;
    const block = body ? ExtensionLine.bodyBlock(body) : undefined;
    if (block) {
      parts.push('body:');
    } else if (body?.trim()) {
      parts.push(`body="${body.trim().replace(/"/g, '\\"')}"`);
    }
    return [
      `${indent}${lead}${parts.join(' ')}`,
      ...(block ?? []).map((line) => `${inner}|${line ? ` ${line}` : ''}`),
      ...children.flatMap((child) => new ExtensionLine(child).block('', inner)),
    ];
  }
}

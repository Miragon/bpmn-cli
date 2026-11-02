import type { Suggestion } from '../../api/index.js';
import { CommandSyntax } from '../commands/CommandSyntax.js';

export class SuggestedCommand {
  constructor(private readonly operation: Suggestion) {}

  line(path: string): string | undefined {
    const words = CommandSyntax.ofOperation(this.operation)?.wordsOf(this.operation);
    return words && `bpmn ${[...words.command, SuggestedCommand.quoted(path), ...words.rest.map(SuggestedCommand.quoted)].join(' ')}`;
  }

  private static quoted(word: string): string {
    return /^[\w./@%+=:,$-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
  }
}

import type { Command as CommandType } from 'commander';
import { ExtensionLister } from '../../../domain/document/ExtensionLister.js';
import type { EditExtensionElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { commandDoc } from '../report/CommandCatalogue.js';
import { givenFlags, givenStrings, parseKeyValues } from './utils/flags.js';
import { renderExtensionList } from '../report/utils/view-lines.js';

/**
 * Adds, lists and removes vendor extension elements (`bpmn ext add | list | remove`).
 */
export class ExtensionElementsCommand extends MutationCommand {
  register(program: CommandType): void {
    const ext = this.define(program, 'ext');
    this.withMutationOptions(
      this.subcommand(ext, 'add')
        .option('--body <text>', 'text content')
        .option('--xml <snippet>', 'raw XML snippet (may contain nested elements); its roots must be of <type>')
        .option('--replace', 'replace existing elements of the same type (and key) instead of merging'),
    ).action((file: string, id: string, type: string, attrs: string[], options: RawOpts) => this.add(file, id, type, attrs, options));
    this.withMutationOptions(this.subcommand(ext, 'remove')).action((file: string, id: string, typeOrIndex: string, options: RawOpts) => this.remove(file, id, typeOrIndex, options));
    this.withJsonOptions(this.subcommand(ext, 'list')).action((file: string, id: string, options: RawOpts) => this.list(file, id, options));
  }

  private subcommand(ext: CommandType, name: string): CommandType {
    return this.defineSignature(ext, commandDoc('ext').subcommands!.find((subcommand) => subcommand.name === name)!);
  }

  private async add(file: string, id: string, type: string, attrs: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const op: EditExtensionElements = {
      op: 'ext',
      id,
      action: 'add',
      type,
      ...(attrs.length ? { attrs: parseKeyValues(attrs, 'attribute') } : {}),
      ...givenStrings(options, ['body', 'xml']),
      ...givenFlags(options, ['replace']),
    };
    await this.mutate(file, [op], opts);
  }

  /** `2` or `loop.2` is an index into the extension elements; anything else a selector. */
  private async remove(file: string, id: string, typeOrIndex: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const indexed = /^(?:(definition|loop|condition)\.)?(\d+)$/.exec(typeOrIndex.trim());
    const op: EditExtensionElements = indexed
      ? { op: 'ext', id, action: 'remove', index: Number(indexed[2]), ...(indexed[1] ? { slot: indexed[1] as EditExtensionElements['slot'] } : {}) }
      : { op: 'ext', id, action: 'remove', type: typeOrIndex };
    await this.mutate(file, [op], opts);
  }

  private async list(file: string, id: string, options: RawOpts): Promise<void> {
    const doc = await this.cli.readDocArg(file);
    const el = doc.require(id);
    const items = new ExtensionLister().listAll(el);
    if (options['json']) this.cli.printJson(items, !!options['pretty']);
    else this.cli.print(renderExtensionList(items));
  }
}

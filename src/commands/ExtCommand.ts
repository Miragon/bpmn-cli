import type { Command as CommandType } from 'commander';
import { listAllExtensions } from '../ops/ext.js';
import type { ExtOp } from '../ops/types.js';
import { renderExtensionList } from '../report/view-text.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { parseKeyValues } from './utils/flags.js';

export class ExtCommand extends MutationCommand {
  register(program: CommandType): void {
    const ext = this.define(program, 'ext');
    this.withMutationOptions(
      this.subcommand(ext, 'add')
        .option('--body <text>', 'text content')
        .option('--xml <snippet>', 'raw XML snippet (may contain nested elements); its roots must be of <type>')
        .option('--replace', 'replace existing elements of the same type (and key) instead of merging'),
    ).action((file: string, id: string, type: string, attrs: string[], o: RawOpts) => this.add(file, id, type, attrs, o));
    this.withMutationOptions(this.subcommand(ext, 'remove')).action((file: string, id: string, typeOrIndex: string, o: RawOpts) => this.remove(file, id, typeOrIndex, o));
    this.withJsonOptions(this.subcommand(ext, 'list')).action((file: string, id: string, o: RawOpts) => this.list(file, id, o));
  }

  private subcommand(ext: CommandType, name: string): CommandType {
    return this.defineSignature(ext, CliCommand.catalogue.command('ext').subcommands!.find((s) => s.name === name)!);
  }

  private async add(file: string, id: string, type: string, attrs: string[], o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const op: ExtOp = {
        op: 'ext',
        id,
        action: 'add',
        type,
        ...(attrs.length ? { attrs: parseKeyValues(attrs, 'attribute') } : {}),
        ...(o['body'] ? { body: String(o['body']) } : {}),
        ...(o['xml'] ? { xml: String(o['xml']) } : {}),
        ...(o['replace'] ? { replace: true } : {}),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }

  private async remove(file: string, id: string, typeOrIndex: string, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      // `2` or `loop.2`: an index (of the element's own / of a nested element's extension elements); anything else a selector
      const indexed = /^(?:(definition|loop|condition)\.)?(\d+)$/.exec(typeOrIndex.trim());
      const op: ExtOp = indexed
        ? { op: 'ext', id, action: 'remove', index: Number(indexed[2]), ...(indexed[1] ? { slot: indexed[1] as ExtOp['slot'] } : {}) }
        : { op: 'ext', id, action: 'remove', type: typeOrIndex };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }

  private async list(file: string, id: string, o: RawOpts): Promise<void> {
    await this.cli.guarded(async () => {
      const doc = await this.cli.readDocArg(file);
      const el = doc.require(id);
      const items = listAllExtensions(el);
      if (o['json']) this.cli.printJson(items, !!o['pretty']);
      else this.cli.print(renderExtensionList(items));
    }, !!o['json']);
  }
}

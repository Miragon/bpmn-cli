import type { Command as CommandType } from 'commander';
import { DocFile } from '../node/DocFile.js';
import { ModelFile } from '../node/ModelFile.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { splitList } from './utils/flags.js';

export class LayoutCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'layout')
        .option('--expand <ids>', 'comma-separated sub-process ids to expand')
        .option('--collapse <ids>', 'comma-separated sub-process ids to collapse')
        .option('--tidy', 'keep the drawing: remove overlaps and gaps < 20 px with minimal moves (= bpmn tidy)'),
      { layoutToggle: false },
    ).action((file: string, o: RawOpts) => this.run(file, o));
  }

  private async run(file: string, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      // the ids are validated like `set <id> expanded=`: unknown ids and non-sub-processes are errors, not silent no-ops
      const expand = splitList(o['expand'] as string | undefined);
      const collapse = splitList(o['collapse'] as string | undefined);
      const layoutOpts = { tidy: !!o['tidy'], ...(expand ? { expand } : {}), ...(collapse ? { collapse } : {}) };
      await this.runMutation(
        file,
        opts,
        (fo) => new ModelFile(file).layout({ ...fo, ...layoutOpts }),
        (doc, fo) => new DocFile(doc).layout({ ...fo, ...layoutOpts }),
      );
    }, opts.json);
  }
}

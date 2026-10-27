import type { Command as CommandType } from 'commander';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { splitList } from './utils/flags.js';

/**
 * Redraws the diagram from the semantic model (`bpmn layout`).
 */
export class LayoutCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'layout')
        .option('--expand <ids>', 'comma-separated sub-process ids to expand')
        .option('--collapse <ids>', 'comma-separated sub-process ids to collapse')
        .option('--tidy', 'keep the drawing: remove overlaps and gaps < 20 px with minimal moves (= bpmn tidy)'),
      { layoutToggle: false },
    ).action((file: string, options: RawOpts) => this.run(file, options));
  }

  /** --expand / --collapse are validated like `set <id> expanded=`: unknown ids and non-sub-processes are errors. */
  private async run(file: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      const expand = splitList(options['expand'] as string | undefined);
      const collapse = splitList(options['collapse'] as string | undefined);
      const layoutOpts = { tidy: !!options['tidy'], ...(expand ? { expand } : {}), ...(collapse ? { collapse } : {}) };
      await this.runMutation(
        file,
        opts,
        (fo) => this.cli.useCases.relayout.relayout({ ...fo, ...layoutOpts, source: { file } }),
        (doc, fo) => this.cli.useCases.relayout.relayout({ ...fo, ...layoutOpts, source: { doc } }),
      );
    }, opts.json);
  }
}

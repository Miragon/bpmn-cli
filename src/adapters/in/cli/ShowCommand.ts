import { existsSync } from 'node:fs';
import type { Command as CommandType } from 'commander';
import { ShownText } from '../report/ShownText.js';
import { renderConventions } from '../../../domain/document/utils/conventions-text.js';
import type { ViewOptions } from '../../../domain/views/ViewRequest.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { depthArg } from './utils/flags.js';

/**
 * Prints the model, or one element, as the AI sees it: no coordinates (`bpmn show`).
 * With --conventions it lists the id conventions new ids follow.
 */
export class ShowCommand extends CliCommand {
  /** --lint-config is declared before --no-lint-config, so neither given leaves lintConfig undefined. */
  register(program: CommandType): void {
    this.withJsonOptions(
      this.define(program, 'show')
        .option('--scope <id>', 'only this process / sub-process / participant')
        .option('--around <id>', 'only the neighbourhood of this element: --depth flow steps along sequence flows, both ways')
        .option('--depth <n>', 'with --around: flow steps (default 2)', depthArg)
        .option('--inner', 'with --around: also enter sub-processes from outside')
        .option('--context', 'with an id: the element in its context (where, lane, before / after, what catches it, message flows)')
        .option('--layout', 'the drawing instead of the model: rows of node ids per pool / lane with their columns (c0..cN), wide gaps, colours, label sides, layout problems')
        .option('--conventions', "the id conventions new ids follow here: element-id-naming of the .bpmnlintrc (prefixes, case, qualifier) and the file's own style; a file that does not exist yet: those of a new model there")
        .option('--lint-config <path>', "with --conventions: the project's bpmnlint configuration (default: the nearest .bpmnlintrc above the file, up to the repository root, whoever owns it; outside one only in the file's directory; stdin: from the working directory)")
        .option('--no-lint-config', 'with --conventions: do not read the .bpmnlintrc (no id conventions from element-id-naming)'),
    ).action((file: string, id: string | undefined, options: RawOpts) => this.cli.guarded(() => (options['conventions'] ? this.conventions(file, id, options) : this.view(file, id, options)), !!options['json']));
  }

  /** A file that does not exist yet gets the conventions a new model there gets (before `bpmn new`). */
  private async conventions(file: string, id: string | undefined, options: RawOpts): Promise<void> {
    const extra = [...(id !== undefined ? ['the element id'] : []), ...['scope', 'around', 'depth', 'inner', 'context', 'layout'].filter((key) => options[key] !== undefined && options[key] !== false).map((key) => `--${key}`)];
    if (extra.length) throw usageError(`--conventions shows the id conventions of the whole file; drop ${extra.join(' and ')}`, { hint: 'Use `bpmn show <file> --conventions`.' });
    const doc = file === '-' || existsSync(file) ? await this.cli.readDocArg(file) : undefined;
    const view = await this.cli.useCases.showConventions.show({ ...this.lintOptions(options), ...(file === '-' ? {} : { file }), ...(doc ? { doc } : {}) });
    if (options['json']) this.cli.printJson(view, !!options['pretty']);
    else this.cli.print(renderConventions(view));
  }

  /** Refuses --lint-config / --no-lint-config: the .bpmnlintrc only decides the id conventions. */
  private async view(file: string, id: string | undefined, options: RawOpts): Promise<void> {
    if (options['lintConfig'] !== undefined) {
      throw usageError(`${options['lintConfig'] === false ? '--no-lint-config' : '--lint-config'} goes only with --conventions`, { hint: 'Use `bpmn show <file> --conventions --lint-config <path>` (or --no-lint-config).' });
    }
    const opts: ViewOptions = {
      ...(id !== undefined ? { id } : {}),
      ...(options['context'] ? { context: true } : {}),
      ...(options['around'] !== undefined ? { around: String(options['around']) } : {}),
      ...(options['depth'] !== undefined ? { depth: options['depth'] as number } : {}),
      ...(options['inner'] ? { inner: true } : {}),
      ...(options['scope'] !== undefined ? { scope: String(options['scope']) } : {}),
      ...(options['layout'] ? { layout: true } : {}),
    };
    const doc = await this.cli.readDocArg(file);
    const shown = this.cli.useCases.showModel.show({ ...opts, doc });
    if (options['json']) this.cli.printJson(shown.kind === 'layout' ? { file, ...shown.view } : shown.view, !!options['pretty']);
    else this.cli.print(new ShownText(shown).text());
  }
}

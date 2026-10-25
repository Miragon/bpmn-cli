import { existsSync } from 'node:fs';
import type { Command as CommandType } from 'commander';
import { renderShown } from '../api.js';
import { ConventionsTable } from '../ids/ConventionsTable.js';
import { renderConventions } from '../ids/utils/conventions-text.js';
import { ConventionsLookup } from '../node/ConventionsLookup.js';
import { ViewRequest, type ViewOptions } from '../query/ViewRequest.js';
import { usageError } from '../shared/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { depthArg } from './utils/flags.js';

/**
 * Prints the model, or one element, as the AI sees it: no coordinates (`bpmn show`).
 * With --conventions it lists the id conventions new ids follow.
 */
export class ShowCommand extends CliCommand {
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
        // --lint-config before --no-lint-config: neither given leaves lintConfig undefined
        .option('--lint-config <path>', "with --conventions: the project's bpmnlint configuration (default: the nearest .bpmnlintrc above the file, up to the repository root, whoever owns it; outside one only in the file's directory; stdin: from the working directory)")
        .option('--no-lint-config', 'with --conventions: do not read the .bpmnlintrc (no id conventions from element-id-naming)'),
    ).action((file: string, id: string | undefined, o: RawOpts) => this.cli.guarded(() => (o['conventions'] ? this.conventions(file, id, o) : this.view(file, id, o)), !!o['json']));
  }

  private async conventions(file: string, id: string | undefined, o: RawOpts): Promise<void> {
    const extra = [...(id !== undefined ? ['the element id'] : []), ...['scope', 'around', 'depth', 'inner', 'context', 'layout'].filter((k) => o[k] !== undefined && o[k] !== false).map((k) => `--${k}`)];
    if (extra.length) throw usageError(`--conventions shows the id conventions of the whole file; drop ${extra.join(' and ')}`, { hint: 'Use `bpmn show <file> --conventions`.' });
    // a file that does not exist yet: the conventions a new model there gets (before `bpmn new`)
    const doc = file === '-' || existsSync(file) ? await this.cli.readDocArg(file) : undefined;
    const lookup = await ConventionsLookup.of(file === '-' ? undefined : file, this.lintOptions(o));
    const { conventions, ...rest } = lookup.options(file === '-' ? undefined : file);
    const view = new ConventionsTable(doc, conventions).view(rest);
    if (o['json']) this.cli.printJson(view, !!o['pretty']);
    else this.cli.print(renderConventions(view));
  }

  private async view(file: string, id: string | undefined, o: RawOpts): Promise<void> {
    // the .bpmnlintrc only decides the id conventions here
    if (o['lintConfig'] !== undefined) {
      throw usageError(`${o['lintConfig'] === false ? '--no-lint-config' : '--lint-config'} goes only with --conventions`, { hint: 'Use `bpmn show <file> --conventions --lint-config <path>` (or --no-lint-config).' });
    }
    const opts: ViewOptions = {
      ...(id !== undefined ? { id } : {}),
      ...(o['context'] ? { context: true } : {}),
      ...(o['around'] !== undefined ? { around: String(o['around']) } : {}),
      ...(o['depth'] !== undefined ? { depth: o['depth'] as number } : {}),
      ...(o['inner'] ? { inner: true } : {}),
      ...(o['scope'] !== undefined ? { scope: String(o['scope']) } : {}),
      ...(o['layout'] ? { layout: true } : {}),
    };
    const doc = await this.cli.readDocArg(file);
    const shown = new ViewRequest(opts).of(doc);
    if (o['json']) this.cli.printJson(shown.kind === 'layout' ? { file, ...shown.view } : shown.view, !!o['pretty']);
    else this.cli.print(renderShown(shown));
  }
}

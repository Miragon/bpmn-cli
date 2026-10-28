import { basename } from 'node:path';
import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { ViewRequest } from '../../../domain/views/ViewRequest.js';
import { RENDER_MAX_SIZE, type RenderOptions } from '../../../application/port/in/RenderSvgUseCase.js';
import { RenderReport } from './RenderReport.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import { CliCommand, type RawOpts } from './CliCommand.js';
import { assertPathFlags, depthArg, RENDER_FORMATS, renderFormat, splitList } from './utils/flags.js';

/**
 * Draws the diagram, or a crop of it, as a PNG or SVG image (`bpmn render`).
 */
export class RenderCommand extends CliCommand {
  register(program: CommandType): void {
    this.withJsonOptions(
      this.define(program, 'render')
        .option('-o, --out <file>', 'the image file, .png or .svg (another name needs --format; - = stdout); default: bpmn-cli/<name>.png in the temp directory; tiles: <name>-1.png, <name>-2.png, ...')
        .option('--format <format>', 'png (default) or svg; default: the -o extension', (raw: string) => {
          if (!(RENDER_FORMATS as readonly string[]).includes(raw)) throw new InvalidArgumentError(`expected ${RENDER_FORMATS.join(' or ')}`);
          return raw;
        })
        .option('--plane <id>', 'draw the plane of this collapsed sub-process (or process / collaboration); default: the first diagram, or the crop\'s')
        .option('--around <id>', 'crop: exactly the nodes of `show --around <id>` (--depth flow steps both ways) with their flows, data and annotations')
        .option('--depth <n>', 'with --around: flow steps (default 2)', depthArg)
        .option('--inner', 'with --around: also enter sub-processes from outside')
        .option('--path <ids...>', 'crop: the nodes and flows of the shortest sequence-flow path <fromId> <toId>')
        .option('--via <flowIds...>', 'with --path: flows the path must pass, in order')
        .option('--scope <id>', 'crop: a pool, lane or sub-process and what is drawn inside it')
        .option('--highlight <ids>', 'a halo around these elements (comma-separated; repeatable)', (raw: string, prev: string[] | undefined) => this.collectIds(raw, prev))
        .option('--problems', 'number the layout problems (`bpmn metrics`; with a crop: those of its elements) in the image and list them')
        .option('--tiles', 'when the image would be unreadable (labels below 0.75): split it at the diagram columns into readable tiles')
        .option('--max-size <px>', `the longest edge in px (default ${RENDER_MAX_SIZE}); a larger drawing is scaled down`, this.boundedNumber('px', 50, 20000, true))
        .option('--scale <n>', 'zoom factor (default 1); the image still stays within --max-size', this.boundedNumber('zoom', 0.05, 10, false)),
    ).action((file: string, ids: string[], options: RawOpts) => this.run(file, ids, options));
  }

  private async run(file: string, ids: string[], options: RawOpts): Promise<void> {
    const out = options['out'] as string | undefined;
    const format = renderFormat(options['format'] as string | undefined, out);
    if (out === '-' && format === 'png' && this.cli.io.stdout.isTTY) {
      throw usageError('a PNG is binary and does not go to a terminal', { hint: 'Redirect it (`bpmn render <file> -o - > out.png`), pass -o <file>, or use --format svg.' });
    }
    if (out === '-' && options['tiles']) throw usageError('--tiles writes several images; they do not go to stdout', { hint: 'Pass -o <file.png> (the tiles become <file>-1.png, <file>-2.png, ...).' });
    const around = options['around'] as string | undefined;
    ViewRequest.assertAroundFlags(around, options['depth'] !== undefined ? ['--depth'] : options['inner'] ? ['--inner'] : [], 'render');
    const path = options['path'] as string[] | undefined;
    const via = options['via'] as string[] | undefined;
    assertPathFlags(path, via, { path: 'Put element ids before --path, or end the list with --: `bpmn render f.bpmn --path Event_Start Event_Done -o path.png`.', via: 'Example: --path Event_Start Event_Done --via Flow_Yes.' });
    const highlight = options['highlight'] as string[] | undefined;
    const opts: RenderOptions = {
      maxSize: (options['maxSize'] as number | undefined) ?? RENDER_MAX_SIZE,
      ...(options['scale'] !== undefined ? { scale: options['scale'] as number } : {}),
      ...(options['plane'] !== undefined ? { plane: String(options['plane']) } : {}),
      ...(around !== undefined ? { around: { id: around, ...(options['depth'] !== undefined ? { depth: options['depth'] as number } : {}), ...(options['inner'] ? { inner: true } : {}) } } : {}),
      ...(path ? { path: { from: path[0]!, to: path[1]!, ...(via ? { via } : {}) } } : {}),
      ...(options['scope'] !== undefined ? { scope: String(options['scope']) } : {}),
      ...(ids.length ? { ids } : {}),
      ...(highlight?.length ? { highlight } : {}),
      ...(options['problems'] ? { problems: true } : {}),
      ...(options['tiles'] ? { tiles: true } : {}),
    };
    const stem = file === '-' ? 'stdin' : basename(file).replace(/\.(bpmn|xml)$/i, '');
    const source = file === '-' ? { bytes: await this.cli.readStdin('the model'), name: 'stdin' } : { file };
    const shot = await this.cli.useCases.renderDiagram.render({ source, opts, format, out, stem, stdout: this.cli.io.stdout });
    const report = out === '-' ? this.cli.io.stderr : this.cli.io.stdout;
    if (options['json']) {
      this.cli.printJson({ file, ...shot }, !!options['pretty'], report);
      return;
    }
    this.cli.print(new RenderReport(shot).renderLines(opts).join('\n'), report);
  }

  private boundedNumber(what: string, min: number, max: number, integer: boolean) {
    return (raw: string): number => {
      const number = Number(raw);
      if (!/^\d+(\.\d+)?$/.test(raw.trim()) || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
        throw new InvalidArgumentError(`expected ${integer ? 'a whole number' : 'a number'} from ${min} to ${max} (${what})`);
      }
      return number;
    };
  }

  /** Comma-separated ids; the option may repeat (--highlight A,B --highlight C). */
  private collectIds(raw: string, prev: string[] | undefined): string[] {
    return [...(prev ?? []), ...(splitList(raw) ?? [])];
  }
}

import { basename } from 'node:path';
import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { decodeXmlBytes, readXml } from '../node/utils/files.js';
import { ImageWriter } from '../node/ImageWriter.js';
import { ViewRequest } from '../query/ViewRequest.js';
import { RENDER_MAX_SIZE, type RenderOptions } from '../render/types.js';
import { RenderReport } from '../report/RenderReport.js';
import { usageError } from '../shared/utils/errors.js';
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
        .option('--format <format>', 'png (default) or svg; default: the -o extension', (v: string) => {
          if (!(RENDER_FORMATS as readonly string[]).includes(v)) throw new InvalidArgumentError(`expected ${RENDER_FORMATS.join(' or ')}`);
          return v;
        })
        .option('--plane <id>', 'draw the plane of this collapsed sub-process (or process / collaboration); default: the first diagram, or the crop\'s')
        .option('--around <id>', 'crop: exactly the nodes of `show --around <id>` (--depth flow steps both ways) with their flows, data and annotations')
        .option('--depth <n>', 'with --around: flow steps (default 2)', depthArg)
        .option('--inner', 'with --around: also enter sub-processes from outside')
        .option('--path <ids...>', 'crop: the nodes and flows of the shortest sequence-flow path <fromId> <toId>')
        .option('--via <flowIds...>', 'with --path: flows the path must pass, in order')
        .option('--scope <id>', 'crop: a pool, lane or sub-process and what is drawn inside it')
        .option('--highlight <ids>', 'a halo around these elements (comma-separated; repeatable)', (v: string, prev: string[] | undefined) => this.collectIds(v, prev))
        .option('--problems', 'number the layout problems (`bpmn metrics`; with a crop: those of its elements) in the image and list them')
        .option('--tiles', 'when the image would be unreadable (labels below 0.75): split it at the diagram columns into readable tiles')
        .option('--max-size <px>', `the longest edge in px (default ${RENDER_MAX_SIZE}); a larger drawing is scaled down`, this.boundedNumber('px', 50, 20000, true))
        .option('--scale <n>', 'zoom factor (default 1); the image still stays within --max-size', this.boundedNumber('zoom', 0.05, 10, false)),
    ).action((file: string, ids: string[], o: RawOpts) => this.cli.guarded(() => this.run(file, ids, o), !!o['json']));
  }

  private async run(file: string, ids: string[], o: RawOpts): Promise<void> {
    const out = o['out'] as string | undefined;
    const format = renderFormat(o['format'] as string | undefined, out);
    if (out === '-' && format === 'png' && this.cli.io.stdout.isTTY) {
      throw usageError('a PNG is binary and does not go to a terminal', { hint: 'Redirect it (`bpmn render <file> -o - > out.png`), pass -o <file>, or use --format svg.' });
    }
    if (out === '-' && o['tiles']) throw usageError('--tiles writes several images; they do not go to stdout', { hint: 'Pass -o <file.png> (the tiles become <file>-1.png, <file>-2.png, ...).' });
    const around = o['around'] as string | undefined;
    ViewRequest.assertAroundFlags(around, o['depth'] !== undefined ? ['--depth'] : o['inner'] ? ['--inner'] : [], 'render');
    const path = o['path'] as string[] | undefined;
    const via = o['via'] as string[] | undefined;
    assertPathFlags(path, via, { path: 'Put element ids before --path, or end the list with --: `bpmn render f.bpmn --path Event_Start Event_Done -o path.png`.', via: 'Example: --path Event_Start Event_Done --via Flow_Yes.' });
    const highlight = o['highlight'] as string[] | undefined;
    const opts: RenderOptions = {
      maxSize: (o['maxSize'] as number | undefined) ?? RENDER_MAX_SIZE,
      ...(o['scale'] !== undefined ? { scale: o['scale'] as number } : {}),
      ...(o['plane'] !== undefined ? { plane: String(o['plane']) } : {}),
      ...(around !== undefined ? { around: { id: around, ...(o['depth'] !== undefined ? { depth: o['depth'] as number } : {}), ...(o['inner'] ? { inner: true } : {}) } } : {}),
      ...(path ? { path: { from: path[0]!, to: path[1]!, ...(via ? { via } : {}) } } : {}),
      ...(o['scope'] !== undefined ? { scope: String(o['scope']) } : {}),
      ...(ids.length ? { ids } : {}),
      ...(highlight?.length ? { highlight } : {}),
      ...(o['problems'] ? { problems: true } : {}),
      ...(o['tiles'] ? { tiles: true } : {}),
    };
    const xml = file === '-' ? decodeXmlBytes(await this.cli.readStdin('the model'), 'stdin') : await readXml(file);
    const stem = file === '-' ? 'stdin' : basename(file).replace(/\.(bpmn|xml)$/i, '');
    const shot = await new ImageWriter(this.cli.io.stdout).write(xml, opts, format, out, stem);
    const report = out === '-' ? this.cli.io.stderr : this.cli.io.stdout;
    if (o['json']) {
      this.cli.printJson({ file, ...shot }, !!o['pretty'], report);
      return;
    }
    this.cli.print(new RenderReport(shot).renderLines(opts).join('\n'), report);
  }

  private boundedNumber(what: string, min: number, max: number, integer: boolean) {
    return (v: string): number => {
      const x = Number(v);
      if (!/^\d+(\.\d+)?$/.test(v.trim()) || !Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x))) {
        throw new InvalidArgumentError(`expected ${integer ? 'a whole number' : 'a number'} from ${min} to ${max} (${what})`);
      }
      return x;
    };
  }

  /** Comma-separated ids; the option may repeat (--highlight A,B --highlight C). */
  private collectIds(v: string, prev: string[] | undefined): string[] {
    return [...(prev ?? []), ...(splitList(v) ?? [])];
  }
}

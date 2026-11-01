import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Command } from 'commander';
import { BpmnError, renderXml, type RenderedImage, type RenderOptions } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import { BpmnFile } from '../files/BpmnFile.js';
import { ImageText } from '../output/ImageText.js';

interface RenderFlags {
  o?: string;
  around?: string;
  depth?: string;
  path?: string[];
  problems?: boolean;
  json?: boolean;
}

type ImageFormat = 'png' | 'svg';

export class RenderCommand {
  private static readonly HINTS: Readonly<Record<string, string>> = {
    E_RENDER: 'Run `bpmn validate <file>`; `bpmn render <file> -o <file>.svg` writes the image without the rasteriser.',
    E_NO_MATCH: 'Name ids `bpmn find <file>` lists.',
  };

  constructor(private readonly shell: CliShell) {}

  private static formatOf(target: string | undefined): ImageFormat {
    const extension = target === undefined || target === BpmnFile.STANDARD_STREAM ? 'png' : extname(target).slice(1).toLowerCase();
    if (extension !== 'png' && extension !== 'svg') {
      throw BpmnError.usage(`-o ${target}: expected a file name ending in .png or .svg (the image formats render writes)`, { hint: 'Name the file .png or .svg.' });
    }
    return extension;
  }

  private static defaultTarget(path: string): string {
    const stem = path === BpmnFile.STANDARD_STREAM ? 'stdin' : basename(path).replace(/\.(bpmn|xml)$/i, '');
    return join(tmpdir(), 'bpmn-cli', `${stem}.png`);
  }

  private static async png(image: RenderedImage): Promise<Uint8Array> {
    const { PngRasterizer, RenderError } = await import('@miragon/bpmn-render/png');
    try {
      return (await PngRasterizer.load()).png(image);
    } catch (error) {
      throw error instanceof RenderError ? RenderCommand.inCliWords(error) : error;
    }
  }

  private static inCliWords({ code, message, element }: { code: string; message: string; element?: string | undefined }): BpmnError {
    const details = { ...(element ? { element } : {}), ...(RenderCommand.HINTS[code] ? { hint: RenderCommand.HINTS[code] } : {}) };
    return code === 'E_RENDER' ? BpmnError.io(code, message, details) : BpmnError.model(code, message, details);
  }

  register(program: Command): void {
    program
      .command('render <file> [ids...]')
      .description('an image without a browser, .png or .svg by the -o extension (file - = stdin)')
      .option('-o <file>', 'the image file, .png or .svg; - for stdout; default: bpmn-cli/<name>.png in the temp directory')
      .option('--around <id>', 'crop to the neighbourhood of this element')
      .option('--depth <n>', 'with --around: flow steps both ways')
      .option('--path <ids...>', 'crop to the shortest sequence-flow path <fromId> <toId>')
      .option('--problems', 'number the layout problems in the image and list them')
      .option('--json', 'print the report as JSON')
      .action((path: string, ids: string[], flags: RenderFlags) => this.run(path, ids, flags));
  }

  private optionsOf(ids: readonly string[], { around, depth, path, problems }: RenderFlags): RenderOptions {
    if (path && path.length !== 2) {
      throw BpmnError.usage(`--path takes exactly two ids (from and to), got ${path.length}`, { hint: 'Put element ids before --path, or end the list with --: `bpmn render f.bpmn --path startEvent_start endEvent_done -o path.png`.' });
    }
    return { ids: ids.length ? [...ids] : undefined, around, depth: depth === undefined ? undefined : Number(depth), path: path as [string, string] | undefined, problems };
  }

  private async run(path: string, ids: readonly string[], flags: RenderFlags): Promise<void> {
    const { shell } = this;
    const format = RenderCommand.formatOf(flags.o);
    const toStandardOutput = flags.o === BpmnFile.STANDARD_STREAM;
    if (toStandardOutput && shell.stdout.isTTY) {
      throw BpmnError.usage('a PNG is binary and does not go to a terminal', { hint: 'Redirect it (`bpmn render <file> -o - > out.png`), or pass -o <file>.' });
    }
    const options = this.optionsOf(ids, flags);
    const image = await renderXml(await shell.file.read(path), options);
    const content = format === 'svg' ? image.svg : await RenderCommand.png(image);
    const target = flags.o ?? RenderCommand.defaultTarget(path);
    if (toStandardOutput) {
      shell.stdout.write(content);
    } else {
      await shell.file.write(target, content);
    }
    const { svg: _svg, ...report } = image;
    const out = toStandardOutput ? shell.stderr : shell.stdout;
    if (flags.json) {
      shell.printJson({ file: path, out: target, format, tokens: ImageText.tokensOf(image), ...report }, out);
    } else {
      shell.print(new ImageText(image, target).lines(options).join('\n'), out);
    }
  }
}

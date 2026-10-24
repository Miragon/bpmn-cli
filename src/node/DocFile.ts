import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Doc } from '../model/Doc.js';
import { ioError } from '../shared/utils/errors.js';
import type { Op } from '../ops/types.js';
import { type CheckOptions, type CheckResult, type LayoutDocOptions, type MutationOptions, type MutationResult } from '../pipeline/index.js';
import type { IdConventions } from '../ids/IdConventionsReader.js';
import type { Validator } from '../validate/validators.js';
import { ProjectBpmnlint, type FileBpmnlintOptions } from './ProjectBpmnlint.js';
import { assertNewFile, writeAtomic } from './utils/files.js';
import { DocCheck } from '../pipeline/DocCheck.js';
import { EditTransaction } from '../pipeline/EditTransaction.js';
import { Relayout } from '../pipeline/Relayout.js';

/** Where and whether the node layer writes the result of the in-memory pipeline. */
export interface FileWriteOptions {
  /** write here instead of the input file */
  out?: string;
  /** run everything but do not write */
  dryRun?: boolean;
  /** copy <file> to <file>.bak before writing */
  backup?: boolean;
  /** refuse to overwrite an existing file (`new`; force overrides) */
  mustNotExist?: boolean;
}

export interface FileMutationOptions extends MutationOptions, FileWriteOptions, FileBpmnlintOptions {}

export interface FileLayoutOptions extends LayoutDocOptions, FileWriteOptions, FileBpmnlintOptions {}

export interface FileCheckOptions extends CheckOptions, FileBpmnlintOptions {}

/** What the core gets to know about the file (MutationOptions.file / validators / conventions). */
interface FileContext {
  file?: string;
  validators?: Validator[];
  conventions?: IdConventions;
}

type ContextOptions = FileBpmnlintOptions & { file?: string; validators?: Validator[]; conventions?: IdConventions };

/**
 * A document (loaded or created) and the file its result goes to:
 * opts.out ?? doc.file. Writing (FileMutationOptions): nothing is written with
 * `dryRun` or when a stage fails; `out` writes elsewhere; `backup` copies the
 * input to <file>.bak first; `mustNotExist` refuses an existing target
 * (E_FILE_EXISTS, `new`) unless force. The result says `written: true` and
 * names the file. A result equal to the file it was read from (`unchanged`) is
 * not written back over that file (no new mtime, no sync event; `written:
 * false`); `out` to another file still gets the copy.
 *
 * Validators (MutationOptions.validators) see the file being written (the
 * `out` target with `out`) or checked as `ctx.file`, unless `file` names
 * another. The project's bpmnlint (ProjectBpmnlint) of that file runs as an
 * advisory validator next to the host's (`lintBlocks`: a blocking one); its
 * @miragon/rules/element-id-naming gives the id conventions new ids follow
 * (src/ids/conventions.ts), unless the host passes `conventions` itself (or a
 * validator named bpmnlint: then its own conventions, if any).
 */
export class DocFile {
  constructor(private readonly doc: Doc) {}

  async mutate(ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
    return this.write(opts, (context) => new EditTransaction(this.doc, ops, { ...opts, ...context }).run());
  }

  /** `bpmn layout` (E_IMPORT_LOSSY unless force). */
  async layout(opts: FileLayoutOptions = {}): Promise<MutationResult> {
    new Relayout(opts).assertOptions();
    (this.doc).assertLossless(opts);
    return this.write(opts, (context) => new Relayout({ ...opts, ...context }).run(this.doc));
  }

  /**
   * `bpmn validate`: validation with the platform profile (auto-detected unless
   * `opts.platform`), `opts.validators` and the project's bpmnlint, and a
   * layout dry run; nothing is written. A document without a file looks up its
   * .bpmnlintrc from `opts.lintFrom`.
   */
  async check(opts: FileCheckOptions = {}): Promise<CheckResult> {
    return new DocCheck({ ...opts, ...(await this.context(this.doc.file, opts)) }).run(this.doc);
  }

  /** Runs `compute` (an in-memory pipeline call) and writes its XML to opts.out ?? doc.file unless dryRun. */
  private async write(opts: FileWriteOptions & ContextOptions & { force?: boolean }, compute: (context: FileContext) => Promise<MutationResult>): Promise<MutationResult> {
    const { doc } = this;
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await assertNewFile(target, opts);
    const result = await compute(await this.context(target, opts));
    // a result equal to the file is not written back over it; --out to another file still gets its copy
    const inPlace = !!target && !!doc.file && resolve(target) === resolve(doc.file);
    if (!opts.dryRun && target && !(result.unchanged && inPlace)) {
      if (opts.backup && doc.file) {
        try {
          await copyFile(doc.file, `${doc.file}.bak`);
        } catch {
          /* no original to back up */
        }
      }
      await writeAtomic(target, result.xml);
      result.written = true;
    }
    if (target) {
      result.file = target;
      // the view (--show) describes the target (-o) the result belongs to
      if (result.view) result.view.file = target;
    }
    return result;
  }

  /** The file the validators see (`ctx.file`: opts.file, else the file written or checked), the project's bpmnlint and the id conventions it declares (unless given). */
  private async context(file: string | undefined, opts: ContextOptions): Promise<FileContext> {
    const named = opts.file ?? file;
    // the project's .bpmnlintrc: nothing is loaded without one
    const lint = await new ProjectBpmnlint(named, opts).lint();
    const conventions = opts.conventions ?? lint.conventions;
    return {
      ...(named ? { file: named } : {}),
      ...(lint.validator ? { validators: [...(opts.validators ?? []), lint.validator] } : {}),
      ...(conventions ? { conventions } : {}),
    };
  }
}

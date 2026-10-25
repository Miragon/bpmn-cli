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

export interface FileWriteOptions {
  /** write here instead of the input file */
  out?: string;
  dryRun?: boolean;
  /** copy <file> to <file>.bak before writing */
  backup?: boolean;
  /** refuse to overwrite an existing file unless force */
  mustNotExist?: boolean;
}

export interface FileMutationOptions extends MutationOptions, FileWriteOptions, FileBpmnlintOptions {}

export interface FileLayoutOptions extends LayoutDocOptions, FileWriteOptions, FileBpmnlintOptions {}

export interface FileCheckOptions extends CheckOptions, FileBpmnlintOptions {}

interface FileContext {
  file?: string;
  validators?: Validator[];
  conventions?: IdConventions;
}

type ContextOptions = FileBpmnlintOptions & { file?: string; validators?: Validator[]; conventions?: IdConventions };

/**
 * A document and the file its result goes to (opts.out ?? doc.file). Nothing is written on
 * dryRun or a failed stage, and an unchanged result is not written back over its own file.
 * The project's bpmnlint runs next to the host's validators and supplies the id conventions.
 */
export class DocFile {
  constructor(private readonly doc: Doc) {}

  async mutate(ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
    return this.write(opts, (context) => new EditTransaction(this.doc, ops, { ...opts, ...context }).run());
  }

  async layout(opts: FileLayoutOptions = {}): Promise<MutationResult> {
    new Relayout(opts).assertOptions();
    (this.doc).assertLossless(opts);
    return this.write(opts, (context) => new Relayout({ ...opts, ...context }).run(this.doc));
  }

  async check(opts: FileCheckOptions = {}): Promise<CheckResult> {
    return new DocCheck({ ...opts, ...(await this.context(this.doc.file, opts)) }).run(this.doc);
  }

  private async write(opts: FileWriteOptions & ContextOptions & { force?: boolean }, compute: (context: FileContext) => Promise<MutationResult>): Promise<MutationResult> {
    const { doc } = this;
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await assertNewFile(target, opts);
    const result = await compute(await this.context(target, opts));
    // no new mtime or sync event for an unchanged file; --out to another file still gets its copy
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
        if (result.view) result.view.file = target;
    }
    return result;
  }

  private async context(file: string | undefined, opts: ContextOptions): Promise<FileContext> {
    const named = opts.file ?? file;
    const lint = await new ProjectBpmnlint(named, opts).lint();
    const conventions = opts.conventions ?? lint.conventions;
    return {
      ...(named ? { file: named } : {}),
      ...(lint.validator ? { validators: [...(opts.validators ?? []), lint.validator] } : {}),
      ...(conventions ? { conventions } : {}),
    };
  }
}

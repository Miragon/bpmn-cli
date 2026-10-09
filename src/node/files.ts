/**
 * File I/O around the in-memory pipeline: the only module of the library
 * that touches the file system (Node only; `@miragon/bpmn-cli/node`). The
 * CLI uses it for every command.
 *
 *   readXml(file)                  -> the file's text (E_FILE_NOT_FOUND / E_IO)
 *   readDoc(file)                  -> Doc (no lossy-import guard: show, find, metrics)
 *   loadDoc(file, { force })       -> Doc, E_IMPORT_LOSSY unless force (every write)
 *   writeAtomic(file, text)        -> temp file in the same directory, renamed over the target
 *   mutateFile(file, ops, opts)    -> loadDoc + mutateDoc + write (every mutating command)
 *   mutateDocToFile(doc, ops, opts)-> mutateDoc + write to opts.out ?? doc.file (`new`)
 *   layoutFile(file, opts)         -> loadDoc + layoutDoc + write (`layout`)
 *   checkFile(file, { platform })  -> readDoc + checkDoc (`validate`)
 *
 * Writing (FileMutationOptions): nothing is written with `dryRun` or when a
 * stage fails; `out` writes elsewhere; `backup` copies the input to
 * <file>.bak first; `mustNotExist` refuses an existing target (E_FILE_EXISTS,
 * `new`) unless force. The result says `written: true` and names the file.
 * A result equal to the file it was read from (`unchanged`) is not written
 * back over that file (no new mtime, no sync event; `written: false`); `out`
 * to another file still gets the copy.
 */
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Doc } from '../document.js';
import { CliError, ioError } from '../errors.js';
import type { Op } from '../ops/types.js';
import { assertLayoutOptions, assertLossless, checkDoc, layoutDoc, mutateDoc, type CheckResult, type LayoutDocOptions, type MutationOptions, type MutationResult } from '../pipeline.js';
import type { PlatformChoice } from '../platform/profile.js';

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

export interface FileMutationOptions extends MutationOptions, FileWriteOptions {}

export interface FileLayoutOptions extends LayoutDocOptions, FileWriteOptions {}

/** Reads a file as UTF-8 text. */
export async function readXml(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw ioError(e.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ${file}: ${e.message}`, { file });
  }
}

/** Reads and parses a file (no lossy-import guard: for reading commands). */
export async function readDoc(file: string): Promise<Doc> {
  return Doc.fromXml(await readXml(file), file);
}

/** Loads a file and refuses to continue when bpmn-moddle dropped content (E_IMPORT_LOSSY unless force). */
export async function loadDoc(file: string, opts: { force?: boolean } = {}): Promise<Doc> {
  const doc = await readDoc(file);
  assertLossless(doc, opts);
  return doc;
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

/** Runs `compute` (an in-memory pipeline call) and writes its XML to opts.out ?? doc.file unless dryRun. */
async function toFile(doc: Doc, opts: FileWriteOptions & { force?: boolean }, compute: () => Promise<MutationResult>): Promise<MutationResult> {
  const target = opts.out ?? doc.file;
  if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
  if (opts.mustNotExist && target && !opts.force && !opts.dryRun) {
    try {
      await stat(target);
      throw ioError('E_FILE_EXISTS', `${target} already exists`, { file: target, hint: 'Choose another name or pass --force to overwrite.' });
    } catch (err) {
      if (err instanceof CliError) throw err;
      /* does not exist: fine */
    }
  }
  const result = await compute();
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

/** Applies ops to a loaded (or created) document and writes the result to opts.out ?? doc.file. */
export async function mutateDocToFile(doc: Doc, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
  return toFile(doc, opts, () => mutateDoc(doc, ops, opts));
}

/** Loads a file, applies ops, writes back (or to opts.out). */
export async function mutateFile(file: string, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
  const doc = await loadDoc(file, opts);
  return mutateDocToFile(doc, ops, opts);
}

/** `bpmn layout`: loads a file, redraws it (or with `tidy` removes overlaps), writes back. */
export async function layoutFile(file: string, opts: FileLayoutOptions = {}): Promise<MutationResult> {
  assertLayoutOptions(opts);
  const doc = await loadDoc(file, opts);
  return toFile(doc, opts, () => layoutDoc(doc, opts));
}

/** `bpmn validate`: validation with the platform profile (auto-detected unless `opts.platform`) and a layout dry run; nothing is written. */
export async function checkFile(file: string, opts: { platform?: PlatformChoice } = {}): Promise<CheckResult> {
  return checkDoc(await readDoc(file), opts);
}

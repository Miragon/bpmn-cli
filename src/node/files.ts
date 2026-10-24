/**
 * File I/O around the in-memory pipeline: the only module of the library
 * that touches the file system (Node only; `@miragon/bpmn-cli/node`). The
 * CLI uses it for every command.
 *
 *   readXml(file)                  -> the file's text, decoded as the file declares (E_FILE_NOT_FOUND / E_IO)
 *   readDoc(file)                  -> Doc (no lossy-import guard: show, find, metrics)
 *   loadDoc(file, { force })       -> Doc, E_IMPORT_LOSSY unless force (every write)
 *   writeAtomic(file, text)        -> temp file in the same directory, renamed over the target (E_IO: no temp file left)
 *   mutateFile(file, ops, opts)    -> loadDoc + mutateDoc + write (every mutating command)
 *   mutateDocToFile(doc, ops, opts)-> mutateDoc + write to opts.out ?? doc.file (`new`)
 *   layoutFile(file, opts)         -> loadDoc + layoutDoc + write (`layout`)
 *   layoutDocToFile(doc, opts)     -> layoutDoc + write to opts.out ?? doc.file (`layout -`: a model read from stdin)
 *   checkFile(file, opts)          -> readDoc + checkDoc (`validate`)
 *   checkLoadedDoc(doc, opts)      -> checkDoc on a document without a file (`validate -`)
 *
 * Writing (FileMutationOptions): nothing is written with `dryRun` or when a
 * stage fails; `out` writes elsewhere; `backup` copies the input to
 * <file>.bak first; `mustNotExist` refuses an existing target (E_FILE_EXISTS,
 * `new`) unless force. The result says `written: true` and names the file.
 * A result equal to the file it was read from (`unchanged`) is not written
 * back over that file (no new mtime, no sync event; `written: false`); `out`
 * to another file still gets the copy.
 *
 * Encoding: a file is read in the encoding its XML declaration names
 * (decodeXmlBytes: UTF-8 without one, UTF-16 by its byte order mark), so
 * that the characters of an ISO-8859-1 / Windows-1252 file survive; every
 * write is UTF-8, and a changed result declares UTF-8 (src/xml/encoding.ts).
 *
 * Validators (MutationOptions.validators): they see the file being written
 * (the `out` target with `out`) or checked as `ctx.file`, unless `file` names
 * another.
 *
 * The project's bpmnlint (FileBpmnlintOptions, src/node/bpmnlint.ts): the
 * nearest .bpmnlintrc above that file (up to the repository root, outside
 * one only in its directory; a document without a file: from `lintFrom`),
 * or `lintConfig`, runs as an advisory validator next to the host's
 * (`lintBlocks`: a blocking one); without a .bpmnlintrc nothing is loaded.
 * Its @miragon/rules/element-id-naming gives the id conventions new ids
 * follow (src/ids/conventions.ts), unless the host passes `conventions` itself
 * (or a validator named bpmnlint: then its own conventions, if any).
 */
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Doc } from '../model/document.js';
import { declaredEncoding, isUtf8 } from '../xml/encoding.js';
import { ioError } from '../shared/utils/errors.js';
import type { Op } from '../ops/types.js';
import { assertLayoutOptions, assertLossless, checkDoc, layoutDoc, mutateDoc, type CheckOptions, type CheckResult, type LayoutDocOptions, type MutationOptions, type MutationResult } from '../pipeline/index.js';
import type { IdConventions } from '../ids/conventions.js';
import type { Validator } from '../validate/validators.js';
import { projectLint, type FileBpmnlintOptions } from './bpmnlint.js';

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

/**
 * The text of an XML file's bytes, in the encoding the file declares: UTF-8
 * (a byte order mark kept as U+FEFF, as before) without a declaration or
 * when it says UTF-8, UTF-16 when it starts with that byte order mark, else
 * the declared encoding (WHATWG names: ISO-8859-1 reads as Windows-1252,
 * like browsers). A declared encoding this runtime cannot decode is E_IO,
 * unless every byte is ASCII (then every ASCII-based encoding reads alike).
 */
export function decodeXmlBytes(bytes: Uint8Array, file = 'the file'): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const head = buf.subarray(0, 512).toString('latin1');
  const encoding = declaredEncoding(head.replace(/^\u00ef\u00bb\u00bf/, '\uFEFF'));
  if (encoding === undefined || isUtf8(encoding)) return buf.toString('utf8');
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding.trim());
  } catch {
    if (buf.every((b) => b < 0x80)) return buf.toString('utf8');
    throw ioError('E_IO', `Cannot read ${file}: it declares the encoding ${encoding}, which bpmn cannot decode`, { file, hint: 'Convert the file to UTF-8 (and declare encoding="UTF-8"), e.g. with iconv.' });
  }
  return decoder.decode(buf);
}

/** Reads a file as text, decoded as it declares (decodeXmlBytes). */
export async function readXml(file: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw ioError(e.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ${file}: ${e.message}`, { file });
  }
  return decodeXmlBytes(bytes, file);
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

/** Atomic write: temp file in the same directory, then rename over the target; a write that fails (a directory as the target) is E_IO and leaves no temp file. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const e = err as NodeJS.ErrnoException;
    throw ioError('E_IO', `Cannot write ${file}: ${e.code === 'EISDIR' ? 'it is a directory' : e.message}`, { file, hint: 'Name a file (not a directory) in a directory you can write to.' });
  }
}

/** What the core gets to know about the file (MutationOptions.file / validators / conventions). */
interface FileContext {
  file?: string;
  validators?: Validator[];
  conventions?: IdConventions;
}

type ContextOptions = FileBpmnlintOptions & { file?: string; validators?: Validator[]; conventions?: IdConventions };

/** The file the validators see (`ctx.file`: opts.file, else the file written or checked), the project's bpmnlint and the id conventions it declares (unless given). */
async function fileContext(file: string | undefined, opts: ContextOptions): Promise<FileContext> {
  const named = opts.file ?? file;
  // the project's .bpmnlintrc: nothing is loaded without one
  const lint = await projectLint(named, opts);
  const conventions = opts.conventions ?? lint.conventions;
  return {
    ...(named ? { file: named } : {}),
    ...(lint.validator ? { validators: [...(opts.validators ?? []), lint.validator] } : {}),
    ...(conventions ? { conventions } : {}),
  };
}

/** Throws E_FILE_EXISTS where `target` exists, unless --force or --dry-run (a write that creates its file: `bpmn new`, which checks it before it reads the .bpmnlintrc). */
export async function assertNewFile(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void> {
  if (!target || opts.force || opts.dryRun) return;
  try {
    await stat(target);
  } catch {
    return; // does not exist: fine
  }
  throw ioError('E_FILE_EXISTS', `${target} already exists`, { file: target, hint: 'Choose another name or pass --force to overwrite.' });
}

/** Runs `compute` (an in-memory pipeline call) and writes its XML to opts.out ?? doc.file unless dryRun. */
async function toFile(
  doc: Doc,
  opts: FileWriteOptions & ContextOptions & { force?: boolean },
  compute: (context: FileContext) => Promise<MutationResult>,
): Promise<MutationResult> {
  const target = opts.out ?? doc.file;
  if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
  if (opts.mustNotExist) await assertNewFile(target, opts);
  const result = await compute(await fileContext(target, opts));
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
  return toFile(doc, opts, (context) => mutateDoc(doc, ops, { ...opts, ...context }));
}

/** Loads a file, applies ops, writes back (or to opts.out). */
export async function mutateFile(file: string, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
  const doc = await loadDoc(file, opts);
  return mutateDocToFile(doc, ops, opts);
}

/** `bpmn layout`: loads a file, redraws it (or with `tidy` removes overlaps), writes back. */
export async function layoutFile(file: string, opts: FileLayoutOptions = {}): Promise<MutationResult> {
  assertLayoutOptions(opts);
  return layoutDocToFile(await loadDoc(file, opts), opts);
}

/** `bpmn layout` on a loaded document (E_IMPORT_LOSSY unless force), written to opts.out ?? doc.file unless dryRun. */
export async function layoutDocToFile(doc: Doc, opts: FileLayoutOptions = {}): Promise<MutationResult> {
  assertLayoutOptions(opts);
  assertLossless(doc, opts);
  return toFile(doc, opts, (context) => layoutDoc(doc, { ...opts, ...context }));
}

/**
 * `bpmn validate`: validation with the platform profile (auto-detected unless
 * `opts.platform`), `opts.validators` and the project's bpmnlint, and a
 * layout dry run; nothing is written.
 */
export async function checkFile(file: string, opts: FileCheckOptions = {}): Promise<CheckResult> {
  const doc = await readDoc(file);
  return checkDoc(doc, { ...opts, ...(await fileContext(file, opts)) });
}

/** checkFile for a document read elsewhere (`bpmn validate -`): a document without a file looks up its .bpmnlintrc from `opts.lintFrom`. */
export async function checkLoadedDoc(doc: Doc, opts: FileCheckOptions = {}): Promise<CheckResult> {
  return checkDoc(doc, { ...opts, ...(await fileContext(doc.file, opts)) });
}

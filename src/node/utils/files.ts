import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { declaredEncoding, isUtf8 } from '../../xml/utils/encoding.js';
import { ioError } from '../../shared/utils/errors.js';

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
  const encoding = declaredEncoding(head.replace(/^ï»¿/, '﻿'));
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

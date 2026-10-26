import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { declaredEncoding, isUtf8 } from '../../../../domain/document/utils/encoding.js';
import { ioError } from '../../../../domain/document/utils/errors.js';

/**
 * Decodes XML bytes in the encoding the file declares (UTF-8 without a declaration, UTF-16 by
 * its byte order mark); an undecodable declared encoding is E_IO unless every byte is ASCII.
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
    if (buf.every((byte) => byte < 0x80)) return buf.toString('utf8');
    throw ioError('E_IO', `Cannot read ${file}: it declares the encoding ${encoding}, which bpmn cannot decode`, { file, hint: 'Convert the file to UTF-8 (and declare encoding="UTF-8"), e.g. with iconv.' });
  }
  return decoder.decode(buf);
}

/** Reads a file as text, decoded in the encoding it declares. */
export async function readXml(file: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    throw ioError(error.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ${file}: ${error.message}`, { file });
  }
  return decodeXmlBytes(bytes, file);
}

/** Writes via a temp file and a rename; a failure is E_IO and leaves no temp file behind. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const error = err as NodeJS.ErrnoException;
    throw ioError('E_IO', `Cannot write ${file}: ${error.code === 'EISDIR' ? 'it is a directory' : error.message}`, { file, hint: 'Name a file (not a directory) in a directory you can write to.' });
  }
}

/** Throws E_FILE_EXISTS where `target` exists, unless --force or --dry-run. */
export async function assertNewFile(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void> {
  if (!target || opts.force || opts.dryRun) return;
  try {
    await stat(target);
  } catch {
    return;
  }
  throw ioError('E_FILE_EXISTS', `${target} already exists`, { file: target, hint: 'Choose another name or pass --force to overwrite.' });
}

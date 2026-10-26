import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LoadDocumentPort } from '../../../application/port/out/LoadDocumentPort.js';
import type { SaveDocumentPort } from '../../../application/port/out/SaveDocumentPort.js';
import { assertNewFile, decodeXmlBytes, readXml, writeAtomic } from './utils/files.js';

/** Documents as files on disk; every write is UTF-8. */
export class FileDocumentStore implements LoadDocumentPort, SaveDocumentPort {
  read(file: string): Promise<string> {
    return readXml(file);
  }

  decode(bytes: Uint8Array, source: string): string {
    return decodeXmlBytes(bytes, source);
  }

  async save(target: string, xml: string, opts: { source?: string; unchanged: boolean; backup?: boolean }): Promise<boolean> {
    const inPlace = !!opts.source && resolve(target) === resolve(opts.source);
    if (opts.unchanged && inPlace) return false;
    if (opts.backup && opts.source) await FileDocumentStore.backup(opts.source);
    await writeAtomic(target, xml);
    return true;
  }

  assertNew(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void> {
    return assertNewFile(target, opts);
  }

  /** Copies the file to <file>.bak; a file with no original has nothing to back up. */
  private static async backup(file: string): Promise<void> {
    try {
      await copyFile(file, `${file}.bak`);
    } catch {}
  }
}

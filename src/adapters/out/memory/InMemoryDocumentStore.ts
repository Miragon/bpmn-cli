import type { LoadDocumentPort } from '../../../application/port/out/LoadDocumentPort.js';
import type { SaveDocumentPort } from '../../../application/port/out/SaveDocumentPort.js';
import { ioError } from '../../../domain/document/utils/errors.js';

/** Documents as texts by name, for hosts without files (the browser, the in-memory API). */
export class InMemoryDocumentStore implements LoadDocumentPort, SaveDocumentPort {
  private readonly texts = new Map<string, string>();

  async read(file: string): Promise<string> {
    const text = this.texts.get(file);
    if (text === undefined) throw ioError('E_FILE_NOT_FOUND', `Cannot read ${file}: no such document`, { file });
    return text;
  }

  decode(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
  }

  async save(target: string, xml: string, opts: { source?: string; unchanged: boolean; backup?: boolean }): Promise<boolean> {
    if (opts.unchanged && opts.source === target) return false;
    const original = opts.backup && opts.source ? this.texts.get(opts.source) : undefined;
    if (original !== undefined) this.texts.set(`${opts.source}.bak`, original);
    this.texts.set(target, xml);
    return true;
  }

  async assertNew(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void> {
    if (!target || opts.force || opts.dryRun || !this.texts.has(target)) return;
    throw ioError('E_FILE_EXISTS', `${target} already exists`, { file: target, hint: 'Choose another name or pass force to overwrite.' });
  }
}

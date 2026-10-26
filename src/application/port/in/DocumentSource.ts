import type { Doc } from '../../../domain/document/Doc.js';

/**
 * The document a use case works on:
 * a file it reads through LoadDocumentPort,
 * or one already loaded (stdin, a host's model).
 */
export type DocumentSource = { file: string } | { doc: Doc };

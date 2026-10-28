import type { Doc } from '../../../domain/document/Doc.js';

/**
 * The document a use case works on:
 * a file it reads through the DocumentPort,
 * or one already loaded (stdin, a host's model).
 */
export type DocumentSource = { file: string } | { doc: Doc };

/** The text of a document: a file, bytes read elsewhere (stdin) or XML with the `file` it names, if any. */
export type DocumentText = { file: string } | { bytes: Uint8Array; name: string } | { xml: string; file?: string };

import type { MutationResult } from '../../../domain/batch/types.js';
import type { Doc } from '../../../domain/document/Doc.js';
import type { DocumentSource, DocumentText } from '../in/DocumentSource.js';
import type { FileWriteOptions } from '../in/EditDocumentUseCase.js';

/**
 * Where the use cases read their documents from and write their results to:
 * files for the CLI and `@miragon/bpmn-cli/node`,
 * none for the in-memory API.
 */
export interface DocumentPort {

  /**
   * The document of a source, its text decoded in the encoding its XML declaration names;
   * with `lossless`, E_IMPORT_LOSSY when bpmn-moddle dropped content, unless `force`.
   */
  load(source: DocumentSource | DocumentText, opts?: { lossless?: boolean; force?: boolean }): Promise<Doc>;

  /** The XML text of a source, decoded like `load`. */
  text(source: DocumentText): Promise<string>;

  /**
   * Where a result goes: `out`, else `file`; E_NO_FILE without either unless `dryRun`.
   * With `mustNotExist`, E_FILE_EXISTS where it exists, unless force or dryRun.
   */
  target(file: string | undefined, opts: FileWriteOptions & { force?: boolean }): Promise<string | undefined>;

  /**
   * Writes the result to `target` at once (nothing on `dryRun`) and sets `result.written`:
   * a failed write leaves the old file, an unchanged document is not written back over its own file,
   * with `backup` the file is copied to <file>.bak first.
   */
  save(result: MutationResult, doc: Doc, target: string | undefined, opts: FileWriteOptions): Promise<void>;
}

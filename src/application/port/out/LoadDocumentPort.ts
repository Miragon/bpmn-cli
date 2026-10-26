/**
 * Reads documents:
 * from files for the CLI and `@miragon/bpmn-cli/node`,
 * from memory for the in-memory API.
 */
export interface LoadDocumentPort {

  /** The text of a file, decoded in the encoding its XML declaration names. */
  read(file: string): Promise<string>;

  /**
   * Bytes read elsewhere (stdin), decoded like a file;
   * `source` names them in errors.
   */
  decode(bytes: Uint8Array, source: string): string;
}

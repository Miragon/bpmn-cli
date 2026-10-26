/** Writes documents where a result goes. */
export interface SaveDocumentPort {

  /**
   * Writes `xml` to `target` at once: a failed write leaves the old file.
   * An unchanged document is not written back over its own `source` (no new mtime or sync event);
   * with `backup` the source is copied to <source>.bak first.
   * Returns whether it wrote.
   */
  save(target: string, xml: string, opts: { source?: string; unchanged: boolean; backup?: boolean }): Promise<boolean>;

  /** Throws E_FILE_EXISTS where `target` exists, unless force or dryRun. */
  assertNew(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void>;
}

/** The first line of an error's message (or of the thrown value). */
export function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]!;
}

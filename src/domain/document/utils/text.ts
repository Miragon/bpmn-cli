export function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]!;
}

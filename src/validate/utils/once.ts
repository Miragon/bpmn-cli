export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

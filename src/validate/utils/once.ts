export function once<TResult>(fn: () => Promise<TResult>): () => Promise<TResult> {
  let pending: Promise<TResult> | undefined;
  return () => (pending ??= fn());
}

/** `old` is `''` when a flow without id got one from its new ends. */
export function renamedNote(old: string | undefined): string {
  if (old === '') return ' (id added: it had none)';
  return old ? ` (renamed from ${old}: its id named its old ends)` : '';
}

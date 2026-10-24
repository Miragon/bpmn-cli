/**
 * The detail a change entry gets from what FlowIdFollower.follow did to a flow whose
 * ends changed: ` (renamed from <old>: ...)` when it renamed the flow; for
 * `''`, ` (id added: it had none)`: a flow without id got one from its new
 * ends.
 */
export function renamedNote(old: string | undefined): string {
  if (old === '') return ' (id added: it had none)';
  return old ? ` (renamed from ${old}: its id named its old ends)` : '';
}

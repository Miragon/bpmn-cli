import type { EditContext } from '../../document/EditContext.js';
import type { IdRequest } from '../../document/utils/requests.js';

/** Allocates an id: an explicit one is validated and claimed, else one in the file's style. */
export function allocateId(edit: EditContext, req: IdRequest, explicit: string | undefined): string {
  if (explicit) {
    edit.allocator.claim(explicit);
    return explicit;
  }
  return edit.allocator.allocate(req).id;
}

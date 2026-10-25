import type { Doc } from '../../model/Doc.js';
import type { IdRequest } from '../../ids/utils/requests.js';

/** Allocates an id: an explicit one is validated and claimed, else one in the file's style. */
export function allocateId(doc: Doc, req: IdRequest, explicit: string | undefined): string {
  if (explicit) {
    doc.claimId(explicit);
    return explicit;
  }
  return doc.allocateId(req).id;
}

/**
 * `@miragon/bpmn-cli/node`: the browser-safe core (everything `.` exports)
 * plus the file helpers the CLI uses (src/node/files.ts). Node only.
 */
export * from '../index.js';
export {
  readXml,
  decodeXmlBytes,
  readDoc,
  loadDoc,
  writeAtomic,
  mutateFile,
  mutateDocToFile,
  layoutFile,
  checkFile,
  type FileWriteOptions,
  type FileMutationOptions,
  type FileLayoutOptions,
} from './files.js';
/* the design-iq content repository of a file on disk (bpmiq.yml; the auto validation profile) */
export { findContentRepo, contentModelIds, contentRepoOf, resolveFileProfile, type ContentRepoOnDisk } from './repo.js';

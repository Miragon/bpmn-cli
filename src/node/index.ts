/**
 * `@miragon/bpmn-cli/node`: the browser-safe core (everything `.` exports)
 * plus the file helpers the CLI uses (src/node/files.ts). Node only.
 */
export * from '../index.js';
export {
  readXml,
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

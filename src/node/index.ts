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
  layoutDocToFile,
  checkFile,
  type FileWriteOptions,
  type FileMutationOptions,
  type FileLayoutOptions,
} from './files.js';
/* the drawing as a PNG image (`bpmn render`): renderSvg's SVG rasterised by resvg (WebAssembly, loaded on first use) with the bundled Arimo font */
export { renderPng, type PngImage, type PngRenderResult } from './render.js';

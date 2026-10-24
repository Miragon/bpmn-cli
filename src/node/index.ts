/**
 * `@miragon/bpmn-cli/node`: the browser-safe core (everything `.` exports)
 * plus the file helpers the CLI uses (src/node/files.ts). Node only.
 */
import type { RenderOptions } from '../render/index.js';
import { PngRenderer, type PngRenderResult } from './PngRenderer.js';

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
  checkLoadedDoc,
  type FileCheckOptions,
  type FileWriteOptions,
  type FileMutationOptions,
  type FileLayoutOptions,
} from './files.js';
/* the drawing as a PNG image (`bpmn render`): renderSvg's SVG rasterised by resvg (WebAssembly, loaded on first use) with the bundled Arimo font */
export { type PngImage, type PngRenderResult } from './PngRenderer.js';
/* the project's .bpmnlintrc (nearest above the file, up to the repository root; outside one only in its directory): bpmnlint with the rules bpmn-cli bundles first, project plugins as the fallback; the id conventions of its element-id-naming */
export { findBpmnlintConfig, bpmnlintEngine, loadBpmnlint, projectBpmnlint, projectBpmnlintSettings, projectIdConventions, BPMNLINT_CONFIG_FILE, type BpmnlintChain, type BpmnlintPlugin, type BpmnlintSettings, type BpmnlintTier, type FileBpmnlintOptions, type LoadedBpmnlint, type ProjectIdConventions } from './bpmnlint.js';

/** `bpmn render` (PNG): one plane of the document (or a part, or its tiles) as PNG images (src/node/PngRenderer.ts). */
export function renderPng(xml: string, opts: RenderOptions = {}): Promise<PngRenderResult> {
  return new PngRenderer().render(xml, opts);
}

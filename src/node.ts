/**
 * `@miragon/bpmn-cli/node`: everything the browser-safe core exports plus file helpers. Node only.
 */
import type { Doc } from './domain/document/Doc.js';
import type { EditCommand } from './domain/commands/types.js';
import type { CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
import type { MutationResult } from './domain/batch/types.js';
import type { RenderOptions } from './domain/views/render/types.js';
import { PngRenderer, type PngRenderResult } from './adapters/out/files/PngRenderer.js';
import type { BpmnlintEngine } from './domain/validation/bpmnlint-validator.js';
import type { NamedValidator, Validator } from './domain/validation/validators.js';
import { BpmnlintLibs, type BpmnlintPlugin } from './adapters/out/files/BpmnlintLibs.js';
import { BpmnlintLoader, type LoadedBpmnlint } from './adapters/out/files/BpmnlintLoader.js';
import { ConfigLookup } from './adapters/out/files/ConfigLookup.js';
import type { FileCheckOptions } from './application/port/in/ValidateDocumentUseCase.js';
import type { FileLayoutOptions } from './application/port/in/RelayoutDiagramUseCase.js';
import type { FileMutationOptions } from './application/port/in/EditDocumentUseCase.js';
import { EditDocumentService } from './application/service/EditDocumentService.js';
import { ReadDocumentService } from './application/service/ReadDocumentService.js';
import { RelayoutDiagramService } from './application/service/RelayoutDiagramService.js';
import { ValidateDocumentService } from './application/service/ValidateDocumentService.js';
import { ProjectBpmnlint, type BpmnlintSettings } from './adapters/out/files/ProjectBpmnlint.js';
import type { FileBpmnlintOptions, ProjectIdConventions } from './application/port/out/LoadProjectSettingsPort.js';
import { FileDocumentStore } from './adapters/out/files/FileDocumentStore.js';
import { BpmnlintProjectSettings } from './adapters/out/files/BpmnlintProjectSettings.js';

const FILES = new FileDocumentStore();
const PROJECT = new BpmnlintProjectSettings();

export * from './index.js';
export { readXml, decodeXmlBytes, writeAtomic } from './adapters/out/files/utils/files.js';
export { type FileCheckOptions } from './application/port/in/ValidateDocumentUseCase.js';
export { type FileWriteOptions, type FileMutationOptions } from './application/port/in/EditDocumentUseCase.js';
export { type FileLayoutOptions } from './application/port/in/RelayoutDiagramUseCase.js';
/** Reads and parses a file without the lossy-import guard. */
export function readDoc(file: string): Promise<Doc> { return new ReadDocumentService(FILES).read({ source: { file } }); }
/** Loads a file; fails with E_IMPORT_LOSSY when bpmn-moddle dropped content, unless force. */
export function loadDoc(file: string, opts: { force?: boolean } = {}): Promise<Doc> { return new ReadDocumentService(FILES).read({ source: { file }, lossless: true, ...opts }); }
/** Loads a file, applies ops and writes it back (or to opts.out). */
export function mutateFile(file: string, ops: EditCommand[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new EditDocumentService(PROJECT, FILES, FILES).edit({ ...opts, source: { file }, commands: ops }); }
/** Applies ops to a loaded document and writes it to opts.out ?? doc.file. */
export function mutateDocToFile(doc: Doc, ops: EditCommand[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new EditDocumentService(PROJECT, FILES, FILES).edit({ ...opts, source: { doc }, commands: ops }); }
/** `bpmn layout`: redraws a file (or with `tidy` only removes overlaps) and writes it back. */
export function layoutFile(file: string, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new RelayoutDiagramService(PROJECT, FILES, FILES).relayout({ ...opts, source: { file } }); }
/** `bpmn layout` on a loaded document, written to opts.out ?? doc.file unless dryRun. */
export function layoutDocToFile(doc: Doc, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new RelayoutDiagramService(PROJECT, FILES, FILES).relayout({ ...opts, source: { doc } }); }
/** `bpmn validate`: validates a file and dry-runs the layout without writing anything. */
export function checkFile(file: string, opts: FileCheckOptions = {}): Promise<CheckResult> { return new ValidateDocumentService(PROJECT, FILES).validate({ ...opts, source: { file } }); }
/**
 * checkFile for a document read elsewhere (`bpmn validate -`); without a file
 * the .bpmnlintrc is looked up from `opts.lintFrom`.
 */
export function checkLoadedDoc(doc: Doc, opts: FileCheckOptions = {}): Promise<CheckResult> { return new ValidateDocumentService(PROJECT, FILES).validate({ ...opts, source: { doc } }); }
export { type PngImage, type PngRenderResult } from './adapters/out/files/PngRenderer.js';
export { BPMNLINT_CONFIG_FILE } from './adapters/out/files/ConfigLookup.js';
export type { BpmnlintChain, BpmnlintTier } from './adapters/out/files/ChainResolver.js';
export type { BpmnlintPlugin, BpmnlintSettings, FileBpmnlintOptions, LoadedBpmnlint, ProjectIdConventions };
/** The nearest .bpmnlintrc from `startDir` upwards, not above the repository root. */
export function findBpmnlintConfig(startDir: string): string | undefined { return new ConfigLookup(startDir).nearest(); }
/** bpmnlint's Linter with the bundled rules, for hosts without a .bpmnlintrc. */
export function bpmnlintEngine(): BpmnlintEngine & { plugin: BpmnlintPlugin; bpmnlintVersion: string } { return BpmnlintLibs.engine(); }
/** Reads and resolves a .bpmnlintrc (cached). */
export async function loadBpmnlint(rcPath: string, opts: { explicit?: boolean; projectCode?: boolean; from?: string } = {}): Promise<LoadedBpmnlint> { return new BpmnlintLoader(rcPath, opts).load(); }
/**
 * The project's bpmnlint validator for a file; undefined without a .bpmnlintrc, with
 * `lintConfig: false` or when `validators` already hold one named bpmnlint.
 */
export function projectBpmnlint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {}): Promise<NamedValidator | undefined> { return new ProjectBpmnlint(file, opts).validator(); }
/** The effective rule settings of the .bpmnlintrc that applies to a file. */
export function projectBpmnlintSettings(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<BpmnlintSettings | undefined> { return new ProjectBpmnlint(file, opts).settings(); }
/** The id conventions the file's .bpmnlintrc declares via @miragon/rules/element-id-naming. */
export function projectIdConventions(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<ProjectIdConventions | undefined> { return new ProjectBpmnlint(file, opts).idConventions(); }

/** `bpmn render` (PNG): one plane of the document, a part of it or its tiles as PNG images. */
export function renderPng(xml: string, opts: RenderOptions = {}): Promise<PngRenderResult> {
  return new PngRenderer().render(xml, opts);
}

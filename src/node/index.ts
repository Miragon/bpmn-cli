/**
 * `@miragon/bpmn-cli/node`: everything the browser-safe core exports plus file helpers. Node only.
 */
import type { Doc } from '../model/Doc.js';
import type { Op } from '../ops/types.js';
import type { CheckResult, MutationResult } from '../pipeline/index.js';
import type { RenderOptions } from '../render/types.js';
import { PngRenderer, type PngRenderResult } from './PngRenderer.js';
import type { BpmnlintEngine } from '../validate/bpmnlint-validator.js';
import type { NamedValidator, Validator } from '../validate/validators.js';
import { BpmnlintLibs, type BpmnlintPlugin } from './BpmnlintLibs.js';
import { BpmnlintLoader, type LoadedBpmnlint } from './BpmnlintLoader.js';
import { ConfigLookup } from './ConfigLookup.js';
import { DocFile, type FileCheckOptions, type FileLayoutOptions, type FileMutationOptions } from './DocFile.js';
import { ModelFile } from './ModelFile.js';
import { ProjectBpmnlint, type BpmnlintSettings, type FileBpmnlintOptions, type ProjectIdConventions } from './ProjectBpmnlint.js';

export * from '../index.js';
export { readXml, decodeXmlBytes, writeAtomic } from './utils/files.js';
export { type FileCheckOptions, type FileWriteOptions, type FileMutationOptions, type FileLayoutOptions } from './DocFile.js';
/** Reads and parses a file without the lossy-import guard. */
export function readDoc(file: string): Promise<Doc> { return new ModelFile(file).read(); }
/** Loads a file; fails with E_IMPORT_LOSSY when bpmn-moddle dropped content, unless force. */
export function loadDoc(file: string, opts: { force?: boolean } = {}): Promise<Doc> { return new ModelFile(file).load(opts); }
/** Loads a file, applies ops and writes it back (or to opts.out). */
export function mutateFile(file: string, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new ModelFile(file).mutate(ops, opts); }
/** Applies ops to a loaded document and writes it to opts.out ?? doc.file. */
export function mutateDocToFile(doc: Doc, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new DocFile(doc).mutate(ops, opts); }
/** `bpmn layout`: redraws a file (or with `tidy` only removes overlaps) and writes it back. */
export function layoutFile(file: string, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new ModelFile(file).layout(opts); }
/** `bpmn layout` on a loaded document, written to opts.out ?? doc.file unless dryRun. */
export function layoutDocToFile(doc: Doc, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new DocFile(doc).layout(opts); }
/** `bpmn validate`: validates a file and dry-runs the layout without writing anything. */
export function checkFile(file: string, opts: FileCheckOptions = {}): Promise<CheckResult> { return new ModelFile(file).check(opts); }
/**
 * checkFile for a document read elsewhere (`bpmn validate -`); without a file
 * the .bpmnlintrc is looked up from `opts.lintFrom`.
 */
export function checkLoadedDoc(doc: Doc, opts: FileCheckOptions = {}): Promise<CheckResult> { return new DocFile(doc).check(opts); }
export { type PngImage, type PngRenderResult } from './PngRenderer.js';
export { BPMNLINT_CONFIG_FILE } from './ConfigLookup.js';
export type { BpmnlintChain, BpmnlintTier } from './ChainResolver.js';
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

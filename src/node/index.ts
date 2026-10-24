/**
 * `@miragon/bpmn-cli/node`: the browser-safe core (everything `.` exports)
 * plus the file helpers the CLI uses (src/node/ModelFile.ts, src/node/DocFile.ts). Node only.
 */
import type { Doc } from '../model/document.js';
import type { Op } from '../ops/types.js';
import type { CheckResult, MutationResult } from '../pipeline/index.js';
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
/** Reads and parses a file (no lossy-import guard: for reading commands). */
export function readDoc(file: string): Promise<Doc> { return new ModelFile(file).read(); }
/** Loads a file and refuses to continue when bpmn-moddle dropped content (E_IMPORT_LOSSY unless force). */
export function loadDoc(file: string, opts: { force?: boolean } = {}): Promise<Doc> { return new ModelFile(file).load(opts); }
/** Loads a file, applies ops, writes back (or to opts.out). */
export function mutateFile(file: string, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new ModelFile(file).mutate(ops, opts); }
/** Applies ops to a loaded (or created) document and writes the result to opts.out ?? doc.file. */
export function mutateDocToFile(doc: Doc, ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> { return new DocFile(doc).mutate(ops, opts); }
/** `bpmn layout`: loads a file, redraws it (or with `tidy` removes overlaps), writes back. */
export function layoutFile(file: string, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new ModelFile(file).layout(opts); }
/** `bpmn layout` on a loaded document (E_IMPORT_LOSSY unless force), written to opts.out ?? doc.file unless dryRun. */
export function layoutDocToFile(doc: Doc, opts: FileLayoutOptions = {}): Promise<MutationResult> { return new DocFile(doc).layout(opts); }
/** `bpmn validate`: validation with the platform profile, `opts.validators` and the project's bpmnlint, and a layout dry run; nothing is written. */
export function checkFile(file: string, opts: FileCheckOptions = {}): Promise<CheckResult> { return new ModelFile(file).check(opts); }
/** checkFile for a document read elsewhere (`bpmn validate -`): a document without a file looks up its .bpmnlintrc from `opts.lintFrom`. */
export function checkLoadedDoc(doc: Doc, opts: FileCheckOptions = {}): Promise<CheckResult> { return new DocFile(doc).check(opts); }
/* the drawing as a PNG image (`bpmn render`): renderSvg's SVG rasterised by resvg (WebAssembly, loaded on first use) with the bundled Arimo font */
export { renderPng, type PngImage, type PngRenderResult } from './render.js';
/* the project's .bpmnlintrc (nearest above the file, up to the repository root; outside one only in its directory): bpmnlint with the rules bpmn-cli bundles first, project plugins as the fallback; the id conventions of its element-id-naming */
export { BPMNLINT_CONFIG_FILE } from './ConfigLookup.js';
export type { BpmnlintChain, BpmnlintTier } from './ChainResolver.js';
export type { BpmnlintPlugin, BpmnlintSettings, FileBpmnlintOptions, LoadedBpmnlint, ProjectIdConventions };
/** The nearest .bpmnlintrc from `startDir` upwards, not above the repository root (ConfigLookup), or undefined. */
export function findBpmnlintConfig(startDir: string): string | undefined { return new ConfigLookup(startDir).nearest(); }
/** bpmnlint's Linter with the offline tiers of the resolver chain and the plugin: what a library host builds a validator from without a .bpmnlintrc (BpmnlintLibs.engine). */
export function bpmnlintEngine(): BpmnlintEngine & { plugin: BpmnlintPlugin; bpmnlintVersion: string } { return BpmnlintLibs.engine(); }
/** Reads and resolves a .bpmnlintrc (BpmnlintLoader, cached). */
export async function loadBpmnlint(rcPath: string, opts: { explicit?: boolean; projectCode?: boolean; from?: string } = {}): Promise<LoadedBpmnlint> { return new BpmnlintLoader(rcPath, opts).load(); }
/** The bpmnlint validator for a file, or undefined: no .bpmnlintrc, `lintConfig: false`, or `validators` already hold one named bpmnlint (the host's). */
export function projectBpmnlint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {}): Promise<NamedValidator | undefined> { return new ProjectBpmnlint(file, opts).validator(); }
/** The effective rule settings of the .bpmnlintrc that applies to a file (ProjectBpmnlint.settings). */
export function projectBpmnlintSettings(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<BpmnlintSettings | undefined> { return new ProjectBpmnlint(file, opts).settings(); }
/** The id conventions the .bpmnlintrc that applies to a file declares through @miragon/rules/element-id-naming (ProjectBpmnlint.idConventions). */
export function projectIdConventions(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<ProjectIdConventions | undefined> { return new ProjectBpmnlint(file, opts).idConventions(); }

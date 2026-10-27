import { dirname, resolve } from 'node:path';
import type { BpmnlintRuleSetting, BpmnlintUnavailable, ResolvedBpmnlintConfig } from '../../../domain/validation/bpmnlint-validator.js';
import { BpmnlintValidator, BPMNLINT_VALIDATOR } from '../../../domain/validation/BpmnlintValidator.js';
import { bpmnlintUnavailableFindings } from '../../../domain/validation/utils/bpmnlint.js';
import { IdConventionsReader, ID_NAMING_RULE } from '../../../domain/document/ids/IdConventionsReader.js';
import type { NamedValidator, Validator, ValidatorFinding } from '../../../domain/validation/validators.js';
import { BpmnlintLibs } from './BpmnlintLibs.js';
import { BpmnlintLoader, type LoadedBpmnlint } from './BpmnlintLoader.js';
import { ConfigLookup } from './ConfigLookup.js';
import type { FileBpmnlintOptions, ProjectIdConventions } from '../../../application/port/out/LoadProjectSettingsPort.js';
import { ProjectLint } from '../../../domain/validation/ProjectLint.js';

/** The effective bpmnlint settings for a file. */
export interface BpmnlintSettings {
  path: string;
  detail: string;
  /** normalised rule name -> setting, `off` included; unresolvable rules are in `unavailable` */
  rules: Record<string, BpmnlintRuleSetting>;
  unavailable: BpmnlintUnavailable[];
}

/**
 * The project's bpmnlint for a file: the explicit `lintConfig`, else the nearest .bpmnlintrc
 * above the file (or above `lintFrom` without a file), loaded once per instance.
 */
export class ProjectBpmnlint {
  private static readonly conventionsCache = new WeakMap<ResolvedBpmnlintConfig, ProjectIdConventions>();
  private loading: Promise<LoadedBpmnlint | undefined> | undefined;

  constructor(
    private readonly file: string | undefined,
    private readonly opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {},
  ) {}

  /** Nothing when `validators` already hold a bpmnlint: that host passes its own conventions. */
  async lint(): Promise<ProjectLint> {
    if (this.opts.validators?.some((validator) => (typeof validator === 'function' ? validator.name : validator?.name) === BPMNLINT_VALIDATOR)) return ProjectLint.NONE;
    const loaded = await this.loaded();
    if (!loaded) return ProjectLint.NONE;
    const blocks = this.opts.lintBlocks ?? false;
    if (!loaded.ok) {
      const findings = bpmnlintUnavailableFindings(loaded.unavailable);
      return new ProjectLint({ name: BPMNLINT_VALIDATOR, detail: loaded.detail, blocks, validate: () => findings });
    }
    const ids = this.conventionsOf(loaded);
    const validator = new BpmnlintValidator(loaded.engine, loaded.resolved, { detail: `${loaded.detail}${this.ignoredDetail(ids.notes)}`, blocks, unavailable: loaded.notes, notes: ids.notes }).named();
    return new ProjectLint(validator, ids.conventions);
  }

  async validator(): Promise<NamedValidator | undefined> {
    return (await this.lint()).validator;
  }

  /** Returns a new object: the cached notes are the validator's, which a write counts as W_CONFIG_IGNORED. */
  async idConventions(): Promise<ProjectIdConventions | undefined> {
    const loaded = await this.loaded();
    if (!loaded) return undefined;
    if (!loaded.ok) return { notes: bpmnlintUnavailableFindings(loaded.unavailable), where: loaded.where, unavailable: true };
    const ids = this.conventionsOf(loaded);
    const left = bpmnlintUnavailableFindings([...loaded.resolved.unavailable, ...loaded.notes]);
    return left.length ? { ...ids, notes: [...ids.notes, ...left] } : ids;
  }

  async settings(): Promise<BpmnlintSettings | undefined> {
    const loaded = await this.loaded();
    if (!loaded) return undefined;
    if (!loaded.ok) return { path: loaded.path, detail: loaded.detail, rules: {}, unavailable: loaded.unavailable };
    return { path: loaded.path, detail: loaded.detail, rules: loaded.resolved.rules, unavailable: [...loaded.resolved.unavailable, ...loaded.notes] };
  }

  private loaded(): Promise<LoadedBpmnlint | undefined> {
    return (this.loading ??= this.load());
  }

  private async load(): Promise<LoadedBpmnlint | undefined> {
    const rc = this.configFile();
    if (!rc) return undefined;
    return new BpmnlintLoader(rc.path, { explicit: rc.explicit, projectCode: this.opts.lintProjectCode, from: this.opts.lintFrom }).load();
  }

  private configFile(): { path: string; explicit: boolean } | undefined {
    const { opts } = this;
    if (opts.lintConfig === false) return undefined;
    if (typeof opts.lintConfig === 'string') return { path: resolve(opts.lintFrom ?? '', opts.lintConfig), explicit: true };
    const start = this.file !== undefined ? dirname(resolve(this.file)) : opts.lintFrom;
    const found = start !== undefined ? new ConfigLookup(start).nearest() : undefined;
    return found ? { path: found, explicit: false } : undefined;
  }

  private conventionsOf(loaded: LoadedBpmnlint & { ok: true }): ProjectIdConventions {
    const hit = ProjectBpmnlint.conventionsCache.get(loaded.resolved);
    if (hit) return hit;
    const setting = loaded.resolved.rules[ID_NAMING_RULE];
    const libs = BpmnlintLibs.load();
    const out: ProjectIdConventions = { notes: [], where: loaded.where, ...(setting ? { setting } : {}) };
    if (setting && setting.severity !== 'off' && libs instanceof BpmnlintLibs) Object.assign(out, new IdConventionsReader(libs.plugin.naming, loaded.where).read(setting));
    ProjectBpmnlint.conventionsCache.set(loaded.resolved, out);
    return out;
  }

  private ignoredDetail(notes: readonly ValidatorFinding[]): string {
    return notes.length ? `; ${notes.length} element-id-naming value${notes.length === 1 ? '' : 's'} ignored (W_CONFIG_IGNORED; bpmn validate lists ${notes.length === 1 ? 'it' : 'them'})` : '';
  }
}

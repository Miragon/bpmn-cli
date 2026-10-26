import { dirname, resolve } from 'node:path';
import type { BpmnlintRuleSetting, BpmnlintUnavailable, ResolvedBpmnlintConfig } from '../validate/bpmnlint-validator.js';
import { BpmnlintValidator, BPMNLINT_VALIDATOR } from '../validate/BpmnlintValidator.js';
import { bpmnlintUnavailableFindings } from '../validate/utils/bpmnlint.js';
import { IdConventionsReader, ID_NAMING_RULE, type IdConventions } from '../ids/IdConventionsReader.js';
import type { NamedValidator, Validator, ValidatorFinding } from '../validate/validators.js';
import { BpmnlintLibs } from './BpmnlintLibs.js';
import { BpmnlintLoader, type LoadedBpmnlint } from './BpmnlintLoader.js';
import { ConfigLookup } from './ConfigLookup.js';

/** Where and how the node layer runs the project's bpmnlint. */
export interface FileBpmnlintOptions {
  /** the .bpmnlintrc, relative to lintFrom; false: none; default: the nearest one above */
  lintConfig?: string | false;
  /** where a document without a file looks up its .bpmnlintrc; base of shown paths */
  lintFrom?: string;
  /** bpmnlint errors in the change block the write (E_VALIDATION); default: reported as warnings */
  lintBlocks?: boolean;
  /** run plugins the project installed, only in a git repository of the current user */
  lintProjectCode?: boolean;
}

/** What the .bpmnlintrc of a file declares about ids. */
export interface ProjectIdConventions {
  /** absent when element-id-naming is off, not configured, or switches every prefix off */
  conventions?: IdConventions;
  /** W_CONFIG_IGNORED for options new ids cannot follow, W_LINT_UNAVAILABLE for what is left out */
  notes: ValidatorFinding[];
  setting?: BpmnlintRuleSetting;
  where: string;
  /** the .bpmnlintrc could not be loaded; `notes` say why */
  unavailable?: true;
}

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
  async lint(): Promise<{ validator?: NamedValidator; conventions?: IdConventions }> {
    if (this.opts.validators?.some((validator) => (typeof validator === 'function' ? validator.name : validator?.name) === BPMNLINT_VALIDATOR)) return {};
    const loaded = await this.loaded();
    if (!loaded) return {};
    const blocks = this.opts.lintBlocks ?? false;
    if (!loaded.ok) {
      const findings = bpmnlintUnavailableFindings(loaded.unavailable);
      return { validator: { name: BPMNLINT_VALIDATOR, detail: loaded.detail, blocks, validate: () => findings } };
    }
    const ids = this.conventionsOf(loaded);
    const validator = new BpmnlintValidator(loaded.engine, loaded.resolved, { detail: `${loaded.detail}${this.ignoredDetail(ids.notes)}`, blocks, unavailable: loaded.notes, notes: ids.notes }).named();
    return { validator, ...(ids.conventions ? { conventions: ids.conventions } : {}) };
  }

  async validator(): Promise<NamedValidator | undefined> {
    return (await this.lint()).validator;
  }

  async idConventions(): Promise<ProjectIdConventions | undefined> {
    const loaded = await this.loaded();
    if (!loaded) return undefined;
    if (!loaded.ok) return { notes: bpmnlintUnavailableFindings(loaded.unavailable), where: loaded.where, unavailable: true };
    const ids = this.conventionsOf(loaded);
    // a new object: the cached notes are the validator's, which a write counts as W_CONFIG_IGNORED
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

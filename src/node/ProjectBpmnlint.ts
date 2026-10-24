import { dirname, resolve } from 'node:path';
import type { BpmnlintRuleSetting, BpmnlintUnavailable, ResolvedBpmnlintConfig } from '../validate/bpmnlint-validator.js';
import { BpmnlintValidator, BPMNLINT_VALIDATOR } from '../validate/BpmnlintValidator.js';
import { bpmnlintUnavailableFindings } from '../validate/utils/bpmnlint.js';
import { idConventionsFromLint, ID_NAMING_RULE, type IdConventions } from '../ids/conventions.js';
import type { NamedValidator, Validator, ValidatorFinding } from '../validate/validators.js';
import { BpmnlintLibs } from './BpmnlintLibs.js';
import { BpmnlintLoader, type LoadedBpmnlint } from './BpmnlintLoader.js';
import { ConfigLookup } from './ConfigLookup.js';

/** Where and how the node layer runs the project's bpmnlint (FileMutationOptions, FileLayoutOptions, FileCheckOptions). */
export interface FileBpmnlintOptions {
  /** the .bpmnlintrc (`--lint-config <path>`, relative to lintFrom), false: none (`--no-lint-config`); default: the nearest .bpmnlintrc above the file, up to the repository root (outside one: in the file's directory) */
  lintConfig?: string | false;
  /** the working directory: where a document without a file looks up its .bpmnlintrc, and the base of the paths in lint messages; absent: no lookup without a file, absolute paths */
  lintFrom?: string;
  /** errors bpmnlint finds in the change block the write (E_VALIDATION); default false: reported among the warnings */
  lintBlocks?: boolean;
  /** run plugins the project installed (the project tier; only in a git repository of the user running the host); default false: only what bpmn-cli ships; the CLI passes true */
  lintProjectCode?: boolean;
}

/** What the .bpmnlintrc of a file declares about ids (ProjectBpmnlint.idConventions). */
export interface ProjectIdConventions {
  /** the id conventions of its element-id-naming (src/ids/conventions.ts); absent: the rule is off or not configured, or every prefix is switched off */
  conventions?: IdConventions;
  /** W_CONFIG_IGNORED: values of the rule's options new ids do not follow (the validator reports them); W_LINT_UNAVAILABLE: what the configuration leaves out, or why it could not be loaded */
  notes: ValidatorFinding[];
  /** the rule's effective setting, when the configuration has it */
  setting?: BpmnlintRuleSetting;
  /** where the .bpmnlintrc is: `.bpmnlintrc in models` */
  where: string;
  /** the .bpmnlintrc could not be loaded (bpmnlint did not run): its conventions are unknown, `notes` say why */
  unavailable?: true;
}

/** The effective bpmnlint settings for a file (ProjectBpmnlint.settings). */
export interface BpmnlintSettings {
  /** the .bpmnlintrc */
  path: string;
  detail: string;
  /** normalised rule name -> severity and options; `off` included; a rule that cannot be resolved is not here but in `unavailable` */
  rules: Record<string, BpmnlintRuleSetting>;
  unavailable: BpmnlintUnavailable[];
}

/**
 * The project's bpmnlint for a file (the one written or checked: the CLI's -o
 * target; without one the lookup starts at `lintFrom`). Lookup
 * (FileBpmnlintOptions): `lintConfig: false` (--no-lint-config) runs nothing;
 * a `lintConfig` path (--lint-config, relative to `lintFrom`) is used as
 * given; else the nearest .bpmnlintrc above the file (ConfigLookup); a
 * document without a file looks up from `lintFrom` (the CLI passes the
 * working directory: stdin without -o), and without `lintFrom` nowhere. No
 * .bpmnlintrc: nothing is loaded. The .bpmnlintrc is loaded on first use
 * (BpmnlintLoader, once per instance); every view of it has the same lookup,
 * flags, cache and errors.
 */
export class ProjectBpmnlint {
  /** The id conventions of a loaded .bpmnlintrc (idConventionsFromLint on its element-id-naming), computed once per load. */
  private static readonly conventionsCache = new WeakMap<ResolvedBpmnlintConfig, ProjectIdConventions>();
  private loading: Promise<LoadedBpmnlint | undefined> | undefined;

  constructor(
    private readonly file: string | undefined,
    private readonly opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {},
  ) {}

  /**
   * Its validator and the id conventions its element-id-naming declares;
   * nothing with no .bpmnlintrc, `lintConfig: false`, or `validators` that
   * already hold one named bpmnlint (the host's, who passes the conventions of
   * its own configuration).
   */
  async lint(): Promise<{ validator?: NamedValidator; conventions?: IdConventions }> {
    if (this.opts.validators?.some((v) => (typeof v === 'function' ? v.name : v?.name) === BPMNLINT_VALIDATOR)) return {};
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

  /**
   * The id conventions the .bpmnlintrc declares through
   * @miragon/rules/element-id-naming (src/ids/conventions.ts idConventionsFromLint
   * with the plugin's own naming helpers); undefined without a .bpmnlintrc or
   * with `lintConfig: false`. The notes list what `validate` lists about the
   * configuration: its W_CONFIG_IGNORED, and a W_LINT_UNAVAILABLE for what it
   * leaves out (a rule name with a typo leaves element-id-naming out) or for a
   * .bpmnlintrc that cannot be loaded (`unavailable`, no conventions).
   */
  async idConventions(): Promise<ProjectIdConventions | undefined> {
    const loaded = await this.loaded();
    if (!loaded) return undefined;
    if (!loaded.ok) return { notes: bpmnlintUnavailableFindings(loaded.unavailable), where: loaded.where, unavailable: true };
    const ids = this.conventionsOf(loaded);
    // a new object: the cached one's notes are the validator's, which a write counts as W_CONFIG_IGNORED
    const left = bpmnlintUnavailableFindings([...loaded.resolved.unavailable, ...loaded.notes]);
    return left.length ? { ...ids, notes: [...ids.notes, ...left] } : ids;
  }

  /**
   * The effective rule settings (a broken discovered file gives no rules and
   * the file in `unavailable`); undefined without a .bpmnlintrc or with
   * `lintConfig: false`.
   */
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

  /** The .bpmnlintrc that applies, or undefined. */
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
    const l = BpmnlintLibs.load();
    const out: ProjectIdConventions = { notes: [], where: loaded.where, ...(setting ? { setting } : {}) };
    if (setting && setting.severity !== 'off' && l instanceof BpmnlintLibs) Object.assign(out, idConventionsFromLint(setting, l.plugin.naming, { source: loaded.where }));
    ProjectBpmnlint.conventionsCache.set(loaded.resolved, out);
    return out;
  }

  /** The validator line's note on what element-id-naming declares and new ids cannot follow (a write only counts those notes). */
  private ignoredDetail(notes: readonly ValidatorFinding[]): string {
    return notes.length ? `; ${notes.length} element-id-naming value${notes.length === 1 ? '' : 's'} ignored (W_CONFIG_IGNORED; bpmn validate lists ${notes.length === 1 ? 'it' : 'them'})` : '';
  }
}

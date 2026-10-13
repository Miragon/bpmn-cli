/**
 * The project's .bpmnlintrc on disk (Node only): lookup, loading and the
 * resolver chain. The validator itself is the core's (src/bpmnlint.ts).
 *
 *   findBpmnlintConfig(dir)          -> the nearest .bpmnlintrc from dir up to the repository root, or undefined
 *   bpmnlintEngine()                 -> { Linter, resolver } with the plugin's bundled resolver (library hosts)
 *   loadBpmnlint(rcPath)             -> the resolved configuration with its resolver chain (cached on the file's text), or why bpmnlint cannot run
 *   projectBpmnlint(file, opts)      -> the NamedValidator for a file, or undefined (no .bpmnlintrc, --no-lint-config)
 *   projectBpmnlintSettings(file)    -> the effective rule settings (same lookup, flags, cache and errors)
 *   projectIdConventions(file, opts) -> the id conventions its element-id-naming declares (src/conventions.ts), the
 *                                       W_CONFIG_IGNORED notes the validator reports and what it leaves out (same lookup,
 *                                       flags, cache)
 *
 * Lookup (FileBpmnlintOptions): `lintConfig: false` (--no-lint-config) runs
 * nothing; a `lintConfig` path (--lint-config, relative to `lintFrom`) is
 * used as given; else the nearest .bpmnlintrc above the file (the one
 * written or checked: the CLI's -o target), not above the repository root
 * (a `.git` directory or file), whoever owns the repository: a .bpmnlintrc
 * switches on rules bpmn-cli ships and names moddle JSON (read, never run),
 * and its findings are advisory; whose repository it is decides only about
 * project code (tier 3). Outside a repository (also under a `.git` file that
 * names no git directory, which git takes for no repository either) only
 * the start directory counts (bpmnlint's CLI reads only its working
 * directory); a document without a file looks up from `lintFrom` (the CLI
 * passes the working directory: stdin without -o), and without `lintFrom`
 * nowhere. No .bpmnlintrc: nothing is loaded.
 *
 * bpmnlint and @miragon/bpmnlint-plugin-rules (exact dependencies of
 * bpmn-cli) are required on the first .bpmnlintrc, with createRequire (the
 * plugin's CJS build): synchronously (bpmnlintEngine() is synchronous), and
 * with Linter and NodeResolver required from the plugin's own location, so
 * they come from the bpmnlint the plugin's rules import: rules and linter
 * are one bpmnlint even when a project's hoisted bpmnlint is the one the
 * plugin finds (the detail line names a version other than the pinned one),
 * and NodeResolver resolves the shipped tier with CJS resolution from inside
 * the plugin. Loading fails (a bpmnlint older than 11.14 next to the plugin,
 * which npm avoids since the plugin's peer range `>=11.14.0` but an install
 * with --legacy-peer-deps does not; a broken install): W_LINT_UNAVAILABLE,
 * the write goes ahead.
 *
 * The resolver chain asks, per rule and config, until one answers (then it
 * remembers the answer; lint runs never ask the tiers again):
 *  1. bundled: the plugin's createBundledResolver(): bpmnlint's rules and
 *     configs, camunda-compat's camunda-platform-7-24 / camunda-cloud-8-10
 *     with their rules, @miragon/rules; no project code;
 *  2. shipped: bpmnlint's NodeResolver from inside the plugin (its own
 *     dependencies: every config and rule of the camunda-compat version it
 *     pins), for bpmnlint, bpmnlint-plugin-camunda-compat and the plugin
 *     itself; offline, no project code;
 *  3. project: NodeResolver from the .bpmnlintrc's directory, every package
 *     but bpmnlint, only with `lintProjectCode` (the CLI passes it): the only
 *     tier that runs project code, and only inside a git repository of the
 *     user running bpmn-cli, checked as git checks it (repoOff: the
 *     directory, the `.git` itself, not what a link points to, and a `.git`
 *     file's gitdir: a planted /tmp/.git, also a link to `/` or a hard link
 *     to a file of root, does not count; git's safe.directory is not read;
 *     on Windows, where Node reads no owners, only a repository inside the
 *     home directory counts, so a planted C:\.git does not), and only a
 *     package whose entry module lies inside the repository root (no
 *     NODE_PATH, no ~/node_modules, nothing above the repository). In a
 *     repository that does not count (root over another uid's checkout in a
 *     CI container, Windows outside the home directory) tiers 1 and 2 run
 *     and a project plugin is left out with W_LINT_UNAVAILABLE, which says
 *     why. A package whose config this tier answered asks it first for its
 *     rules too (one version per package).
 * What no tier answers is left out and listed with the reason and a hint.
 *
 * moddleExtensions that name a module path are read as JSON from the
 * project (inside the repository root; never executed), else
 * camunda-bpmn-moddle/resources/camunda(.json) and
 * zeebe-bpmn-moddle/resources/zeebe(.json) are the plugin's descriptors
 * (offline); anything else is left out (W_LINT_UNAVAILABLE).
 *
 * Project plugin modules stay in Node's require cache: a long-running host
 * restarts after changing one. The load is cached on the .bpmnlintrc's text,
 * also what it could not resolve: after installing a missing plugin or moddle
 * package, or editing a moddle descriptor, a long-running host restarts too.
 */
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { bpmnlintUnavailableFindings, bpmnlintValidator, BPMNLINT_VALIDATOR, moddleEntries, resolveBpmnlintConfig, type BpmnlintConfig, type BpmnlintEngine, type BpmnlintLinterClass, type BpmnlintResolver, type BpmnlintRuleSetting, type BpmnlintUnavailable, type ResolvedBpmnlintConfig } from '../bpmnlint.js';
import { idConventionsFromLint, ID_NAMING_RULE, type IdConventions, type IdNamingHelpers } from '../conventions.js';
import { ioError } from '../errors.js';
import type { NamedValidator, Validator, ValidatorFinding } from '../validators.js';
import { findUp, gitRoot } from './find-up.js';

export const BPMNLINT_CONFIG_FILE = '.bpmnlintrc';

const PLUGIN = '@miragon/bpmnlint-plugin-rules';

/** The packages bpmn-cli ships (tiers 1 and 2). */
const SHIPPED = new Set(['bpmnlint', 'bpmnlint-plugin-camunda-compat', PLUGIN]);

/** moddleExtensions module paths bpmn-cli answers without the project (the plugin's descriptors), `.json` left out. */
const KNOWN_MODDLE: Record<string, { engine: 'c7' | 'c8'; prefix: string }> = {
  'camunda-bpmn-moddle/resources/camunda': { engine: 'c7', prefix: 'camunda' },
  'zeebe-bpmn-moddle/resources/zeebe': { engine: 'c8', prefix: 'zeebe' },
};

const SKIP_HINT = '--no-lint-config skips bpmnlint.';

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

/** What bpmn-cli uses of @miragon/bpmnlint-plugin-rules (a typed subset of its exports). */
export interface BpmnlintPlugin {
  createBundledResolver(): BpmnlintResolver;
  /** a host's default without a .bpmnlintrc: bpmnlint:recommended, a Miragon preset, the engine's camunda-compat config and moddle descriptor */
  getDefaultLintConfig(options?: { engine?: 'c7' | 'c8'; preset?: 'modeling' | 'automation' }): BpmnlintConfig;
  /** the helpers of its element-id-naming rule (idConventionsFromLint takes them) */
  naming: IdNamingHelpers & {
    eventQualifiers(element: unknown): string[];
    isGeneratedId(id: string): boolean;
  };
}

type Require = ((id: string) => unknown) & { resolve(id: string): string };

interface Libs {
  Linter: BpmnlintLinterClass;
  NodeResolver: new (options: { require: Require }) => BpmnlintResolver;
  plugin: BpmnlintPlugin & { bundledResolverEntries: Record<string, unknown> };
  /** require from inside the plugin package (its own dependency tree) */
  pluginRequire: Require;
  /** the bpmnlint the plugin loads */
  bpmnlint: { version: string; dir: string };
  /** the bpmnlint version bpmn-cli pins */
  pinned: string;
}

/** Why the libraries could not be loaded (kept: one process does not try again). */
interface LoadFailure {
  message: string;
  bpmnlint?: { version: string; dir: string };
  pinned?: string;
}

let libs: Libs | LoadFailure | undefined;

function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0]!;
}

function versionOf(req: Require, pkg: string): { version: string; dir: string } | undefined {
  try {
    const file = req.resolve(`${pkg}/package.json`);
    return { version: String((req(file) as { version?: unknown }).version), dir: dirname(file) };
  } catch {
    return undefined;
  }
}

/** bpmnlint and the plugin, required on first use (see the module header). */
function loadLibs(): Libs | LoadFailure {
  if (libs) return libs;
  const req = createRequire(import.meta.url) as Require;
  let used: { version: string; dir: string } | undefined;
  let pinned: string | undefined;
  try {
    pinned = versionOf(req, 'bpmnlint')?.version;
    const pluginMain = req.resolve(PLUGIN);
    const pluginRequire = createRequire(pluginMain) as Require;
    used = versionOf(pluginRequire, 'bpmnlint');
    const plugin = req(pluginMain) as Libs['plugin'];
    const { Linter } = pluginRequire('bpmnlint') as { Linter: BpmnlintLinterClass };
    const NodeResolver = pluginRequire('bpmnlint/lib/resolver/node-resolver') as Libs['NodeResolver'];
    if (typeof plugin.createBundledResolver !== 'function' || typeof Linter !== 'function') throw new Error(`${PLUGIN} or bpmnlint has an unexpected shape`);
    libs = { Linter, NodeResolver, plugin, pluginRequire, bpmnlint: used ?? { version: '?', dir: '' }, pinned: pinned ?? '?' };
  } catch (err) {
    libs = { message: firstLine(err), ...(used ? { bpmnlint: used } : {}), ...(pinned ? { pinned } : {}) };
  }
  return libs;
}

function isFailure(l: Libs | LoadFailure): l is LoadFailure {
  return 'message' in l;
}

function inside(path: string, root: string): boolean {
  const r = relative(root, path);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/** A path without symlinks, as Node resolves modules (the path itself when it does not exist). */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A path for messages: relative to `from` when given (also when one of them is reached through a symlink). */
function shown(path: string, from?: string): string {
  if (from === undefined) return path;
  const r = inside(path, from) || !inside(real(path), real(from)) ? relative(from, path) : relative(real(from), real(path));
  return r === '' ? '.' : r;
}

/** The repository root of a .bpmnlintrc's directory (the directory itself outside a repository), without symlinks like the paths Node resolves. */
function rootOf(rcDir: string): string {
  return real(gitRoot(rcDir) ?? rcDir);
}

/**
 * A path of the user `uid`, as git decides it (is_path_owned_by_current_uid):
 * the owner of the path itself (lstat: a symbolic link counts by its own
 * owner, not by what it points to); root's paths only for root, and root
 * under sudo also those of the SUDO_UID sudo sets (decimal digits; git's
 * strtoul also takes a leading blank or `+`, which sudo never writes).
 */
function ownedBy(path: string, uid: number): boolean {
  let owner: number;
  try {
    owner = lstatSync(path).uid;
  } catch {
    return false;
  }
  if (owner === uid) return true;
  const sudo = process.env['SUDO_UID'];
  return uid === 0 && sudo !== undefined && /^\d+$/.test(sudo) && owner === Number(sudo);
}

/**
 * Why a repository does not count as the user's (repoOf): `owner`, it
 * belongs to another user; `gitfile`, its `.git` is a file that names no
 * git directory (git takes it for no repository either); `home`, there are
 * no uids (Windows) and it lies outside the home directory.
 */
type RepoOff = 'owner' | 'gitfile' | 'home';

/** A git repository: its root and, when it does not count as the user's, why. */
interface Repo {
  root: string;
  off?: RepoOff;
}

/**
 * Whether the repository at `root` is the user's, checked as git does it
 * (is_path_owned_by_current_uid; git's safe.directory is not read): the
 * directory, its `.git` and, for a `.git` file (a worktree, a submodule:
 * `gitdir: <path>`), the directory it names belong to the user running
 * bpmn-cli. A `.git` link or hard link of another user (to `/`, to a file of
 * root) does not count, nor a `.git` file whose git directory is missing.
 * Where there are no uids (Windows: Node reads no owner there), only a
 * repository inside the user's home directory counts, not one in a
 * directory every user may create (`C:\.git`, CVE-2022-24765).
 */
function repoOff(root: string): RepoOff | undefined {
  const uid = process.getuid?.();
  const dir = real(root);
  if (uid !== undefined && (!ownedBy(dir, uid) || !ownedBy(join(dir, '.git'), uid))) return 'owner';
  const gitdir = gitDirOf(dir);
  if (gitdir === null) return 'gitfile';
  if (uid === undefined) return inHome(dir) ? undefined : 'home';
  return gitdir === undefined || ownedBy(gitdir, uid) ? undefined : 'owner';
}

/**
 * The git directory of the repository at `dir` (without symlinks): undefined
 * for a `.git` directory (or a link to one), the directory a `.git` file
 * names (a worktree, a submodule: `gitdir: <path>`), or null for a `.git`
 * file that names no git directory (git takes it for no repository). Only a
 * regular file of at most 1 MiB is read, as git reads it: the lookup asks
 * before anyone's owner is checked, and a planted FIFO would block the read.
 */
function gitDirOf(dir: string): string | undefined | null {
  const git = join(dir, '.git');
  try {
    const st = statSync(git);
    if (st.isDirectory()) return undefined;
    if (!st.isFile() || st.size > 1 << 20) return null;
    const text = readFileSync(git, 'utf8');
    if (!text.startsWith('gitdir: ')) return null;
    const gitdir = real(resolve(dir, text.slice('gitdir: '.length).replace(/[\r\n]+$/, '')));
    return statSync(gitdir).isDirectory() ? gitdir : null;
  } catch {
    return null;
  }
}

/** Whether `dir` lies inside the user's home directory, and is no filesystem root (the check where there are no uids). */
function inHome(dir: string): boolean {
  let home: string;
  try {
    home = homedir();
  } catch {
    return false;
  }
  return home !== '' && dirname(dir) !== dir && inside(dir, real(home));
}

/** The git repository of a directory (its root, and why it does not count as the user's: repoOff); undefined outside one. */
function repoOf(dir: string): Repo | undefined {
  const root = gitRoot(dir);
  if (root === undefined) return undefined;
  const off = repoOff(root);
  return off ? { root, off } : { root };
}

/** The engine failure as an unavailable entry: what failed, which bpmnlint the plugin found, what to do. */
function engineUnavailable(failure: LoadFailure, from?: string): BpmnlintUnavailable {
  const found = failure.bpmnlint ? `; the plugin found bpmnlint ${failure.bpmnlint.version} in ${shown(failure.bpmnlint.dir, from)}` : '';
  return {
    kind: 'engine',
    name: 'bpmnlint',
    pkg: 'bpmnlint',
    reason: `bpmnlint could not be loaded: ${failure.message}${found}`,
    hint: `bpmn-cli needs bpmnlint >= 11.14 next to ${PLUGIN} (it pins ${failure.pinned ?? '11.15.0'}): update the project's bpmnlint (npm i -D bpmnlint@${failure.pinned ?? '11.15.0'}) or run bpmn-cli from its own install (npx); ${SKIP_HINT}`,
  };
}

/**
 * The nearest .bpmnlintrc from `startDir` upwards, not above the repository
 * root (a `.git` directory or file), whoever owns the repository (repoOff
 * decides only about project code); outside a repository, also under a
 * `.git` file that names no git directory, only the one in `startDir`.
 */
export function findBpmnlintConfig(startDir: string): string | undefined {
  const found = findUp(startDir, [BPMNLINT_CONFIG_FILE], { stopAtGitRoot: true });
  if (!found) return undefined;
  // a parent directory counts only inside a repository: not ~ or /tmp for every model below them
  if (found.dir !== resolve(startDir)) {
    const root = gitRoot(startDir);
    if (root === undefined || gitDirOf(real(root)) === null) return undefined;
  }
  return join(found.dir, found.name);
}

/**
 * bpmnlint's Linter with the plugin's bundled resolver, and the plugin
 * (`getDefaultLintConfig`, `naming`): what a library host builds a validator
 * from without a .bpmnlintrc. Throws an Error that names the bpmnlint
 * versions when the libraries cannot be loaded.
 */
export function bpmnlintEngine(): BpmnlintEngine & { plugin: BpmnlintPlugin; bpmnlintVersion: string } {
  const l = loadLibs();
  if (isFailure(l)) {
    const u = engineUnavailable(l);
    throw new Error(`${u.reason} (${u.hint})`);
  }
  return { Linter: l.Linter, resolver: l.plugin.createBundledResolver(), plugin: l.plugin, bpmnlintVersion: l.bpmnlint.version };
}

/** Which tier answered (BpmnlintChain.used). */
export type BpmnlintTier = 'bundled' | 'shipped' | 'project';

/** The resolver of a .bpmnlintrc; `used`: `rule:<pkg>/<name>` / `config:<pkg>/<name>` -> the tier that answered. */
export interface BpmnlintChain extends BpmnlintResolver {
  readonly used: ReadonlyMap<string, BpmnlintTier>;
}

interface Tier {
  name: BpmnlintTier;
  accepts(pkg: string): boolean;
  get(): BpmnlintResolver;
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** A require that loads entry modules only from inside `root`, and records what failed to load. */
function boundedRequire(fromDir: string, root: string, failures: Map<string, string>): Require {
  const req = createRequire(join(fromDir, '__bpmn-cli__.js')) as Require;
  const check = (id: string): string => {
    const path = req.resolve(id);
    if (!inside(path, root)) throw new Error(`${id} resolves outside the repository (${path})`);
    return path;
  };
  const bounded = ((id: string) => {
    const path = check(id);
    try {
      return req(path);
    } catch (err) {
      failures.set(path, firstLine(err));
      throw err;
    }
  }) as Require;
  bounded.resolve = check;
  return bounded;
}

class ChainResolver implements BpmnlintChain {
  readonly used = new Map<string, BpmnlintTier>();
  private readonly answers = new Map<string, unknown>();
  /** packages whose config the project tier answered: their rules come from there first */
  private readonly pinned = new Set<string>();
  /** modules of the project that failed to load (absolute path -> first line of the error) */
  private readonly loadFailures = new Map<string, string>();
  private readonly tiers: Tier[];
  private readonly root: string;
  /** why the project tier does not run although the host asked for it (no repository, one that is not the user's: offReason), or undefined */
  private readonly off: { why: string; hint: string } | undefined;
  /** the same reason whether or not the host asked: lintProjectCode would not help */
  private readonly repoOff: { why: string; hint: string } | undefined;

  constructor(
    private readonly libs: Libs,
    private readonly rcDir: string,
    private readonly opts: { projectCode?: boolean; from?: string },
    repo: Repo | undefined,
  ) {
    this.root = rootOf(rcDir);
    this.repoOff = offReason(rcDir, repo, opts.from);
    this.off = opts.projectCode ? this.repoOff : undefined;
    this.tiers = [
      { name: 'bundled', accepts: () => true, get: lazy(() => libs.plugin.createBundledResolver()) },
      { name: 'shipped', accepts: (pkg) => SHIPPED.has(pkg), get: lazy(() => new libs.NodeResolver({ require: libs.pluginRequire })) },
      { name: 'project', accepts: (pkg) => !!opts.projectCode && !this.off && pkg !== 'bpmnlint', get: lazy(() => new libs.NodeResolver({ require: boundedRequire(rcDir, this.root, this.loadFailures) })) },
    ];
  }

  resolveRule(pkg: string, ruleName: string): Promise<unknown> {
    return this.first('rule', pkg, ruleName);
  }

  resolveConfig(pkg: string, configName: string): Promise<unknown> {
    return this.first('config', pkg, configName);
  }

  /** The packages the project tier answered for (project code that ran). */
  projectPackages(): string[] {
    return [...new Set([...this.used].filter(([, tier]) => tier === 'project').map(([key]) => key.slice(key.indexOf(':') + 1, key.lastIndexOf('/'))))];
  }

  /** The version of a package the project tier loaded (read from its package.json; data only). */
  projectVersion(pkg: string): string | undefined {
    return versionOf(boundedRequire(this.rcDir, this.root, new Map()), pkg)?.version;
  }

  private async first(kind: 'rule' | 'config', pkg: string, name: string): Promise<unknown> {
    const key = `${kind}:${pkg}/${name}`;
    if (this.answers.has(key)) return this.answers.get(key);
    const tiers = this.pinned.has(pkg) ? [...this.tiers.filter((t) => t.name === 'project'), ...this.tiers.filter((t) => t.name !== 'project')] : this.tiers;
    for (const tier of tiers) {
      if (!tier.accepts(pkg)) continue;
      try {
        const answer = await (kind === 'rule' ? tier.get().resolveRule(pkg, name) : tier.get().resolveConfig(pkg, name));
        if (!answer) continue;
        this.answers.set(key, answer);
        this.used.set(key, tier.name);
        if (kind === 'config' && tier.name === 'project') this.pinned.add(pkg);
        return answer;
      } catch {
        /* the next tier */
      }
    }
    throw this.reason(kind, pkg, name);
  }

  /** Why `pkg/name` is unavailable, and what to do (an Error with `hint`). */
  private reason(kind: 'rule' | 'config', pkg: string, name: string): Error {
    const fail = (message: string, hint: string) => Object.assign(new Error(message), { hint });
    const where = shown(this.rcDir, this.opts.from);
    if (pkg === 'bpmnlint') {
      const v = this.libs.bpmnlint.version;
      return fail(`bpmnlint ${v} has no ${kind} ${name}`, `bpmn-cli runs bpmnlint ${v}; update bpmn-cli or remove the ${kind}.`);
    }
    // where Node finds the package from the .bpmnlintrc (only to tell "not installed" from "outside the repository"; nothing is loaded)
    let path: string | undefined;
    try {
      path = createRequire(join(this.rcDir, '__bpmn-cli__.js')).resolve(pkg);
    } catch {
      path = undefined;
    }
    const projectRuns = !!this.opts.projectCode && !this.off && path !== undefined && inside(path, this.root);
    if (SHIPPED.has(pkg) && !projectRuns) {
      const v = versionOf(this.libs.pluginRequire, pkg)?.version;
      const bundled = `${pkg}${v ? ` ${v}` : ''} (bundled with bpmn-cli) has no ${kind} ${name}`;
      if (path !== undefined && inside(path, this.root)) {
        if (this.off) return fail(`${bundled}, and ${this.off.why}`, this.off.hint);
        return fail(`${bundled}, and this host does not run project plugins (lintProjectCode)`, this.repoOff ? `Check the name; lintProjectCode: true would not load the ${pkg} installed next to the .bpmnlintrc either: ${this.repoOff.why}.` : `Check the name, or let the host pass lintProjectCode: true to use the ${pkg} installed in the repository.`);
      }
      if (this.off) return fail(bundled, `Check the name; ${this.off.why}.`);
      // a library host without lintProjectCode: an install would not help (and not outside a repository of the user either)
      if (!this.opts.projectCode) return fail(bundled, this.repoOff ? `Check the name; a newer ${pkg} installed next to the .bpmnlintrc would not be used either: this host does not run project plugins (lintProjectCode), and ${this.repoOff.why}.` : `Check the name; a newer ${pkg} installed in the repository next to the .bpmnlintrc is used only when the host passes lintProjectCode: true.`);
      return fail(bundled, `Check the name. A newer ${pkg} installed in the repository next to the .bpmnlintrc is used for what the bundled one does not know.`);
    }
    // installed or not: here the project tier does not run
    const offError = this.off && fail(`${pkg} is not bundled with bpmn-cli, and ${this.off.why}`, this.off.hint);
    if (path === undefined) {
      const known = kind === 'rule' ? this.bundledName(pkg, name) : undefined;
      if (known) return fail(`${pkg} is not installed (looked up from ${where})`, `Did you mean ${known}? bpmn-cli bundles that rule.`);
      if (offError) return offError;
      if (!this.opts.projectCode) return fail(`${pkg} is not installed (looked up from ${where})`, this.repoOff ? `Remove it from the configuration; installing it would not help: this host does not run project plugins (lintProjectCode), and ${this.repoOff.why}.` : `Remove it from the configuration, or install it next to the .bpmnlintrc (npm i -D ${pkg}) and let the host pass lintProjectCode: true.`);
      return fail(`${pkg} is not installed (looked up from ${where})`, `Install it next to the .bpmnlintrc (npm i -D ${pkg}) or remove it from the configuration; ${SKIP_HINT}`);
    }
    if (offError) return offError;
    if (!inside(path, this.root)) return fail(`${pkg} resolves outside the repository (${path}); bpmn-cli loads project plugins only from inside ${this.root}`, `Install it inside the repository (npm i -D ${pkg}).`);
    if (!this.opts.projectCode) return fail(`${pkg} is not bundled with bpmn-cli, and this host does not run project plugins (lintProjectCode)`, this.repoOff ? `Remove it from the configuration; lintProjectCode: true would not run it either: ${this.repoOff.why}.` : 'Remove it from the configuration, or let the host pass lintProjectCode: true.');
    const failed = [...this.loadFailures].find(([file]) => file === path || file.includes(`${sep}node_modules${sep}${pkg.split('/').join(sep)}${sep}`));
    if (failed) return fail(`${pkg} fails to load: ${failed[1]}`, `Fix or reinstall ${pkg}; ${SKIP_HINT}`);
    return fail(`${pkg} has no ${kind} ${name}`, `Check the name and the installed version of ${pkg}.`);
  }

  /** The rule `name` bundled in another package, as a .bpmnlintrc writes it (`@miragon/rules/element-id-naming`). */
  private bundledName(pkg: string, name: string): string | undefined {
    const key = Object.keys(this.libs.plugin.bundledResolverEntries).find((k) => k.startsWith('rule:') && k.endsWith(`/${name}`) && k !== `rule:${pkg}/${name}`);
    if (!key) return undefined;
    const owner = key.slice('rule:'.length, key.length - name.length - 1);
    return owner === 'bpmnlint' ? name : `${owner.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${name}`;
  }
}

/** Why the project tier does not run for a .bpmnlintrc in `rcDir` (the host asked for it, or would not help by asking): no git repository, or one that does not count as the user's (repoOff). */
function offReason(rcDir: string, repo: Repo | undefined, from?: string): { why: string; hint: string } | undefined {
  if (!repo) return { why: `bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in ${shown(rcDir, from)} is in none)`, hint: `Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; ${SKIP_HINT}` };
  const git = shown(join(repo.root, '.git'), from);
  if (repo.off === 'owner') return { why: `bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`, hint: `Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; ${SKIP_HINT}` };
  if (repo.off === 'gitfile') return { why: `bpmn-cli runs project plugins only inside a git repository (${git} is a file that names no git directory, so git takes it for no repository either)`, hint: `Fix or remove that .git file (a worktree or submodule whose git directory moved), or remove the plugin from the configuration; ${SKIP_HINT}` };
  if (repo.off === 'home') return { why: `bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)`, hint: `Keep the repository inside your home directory, or remove the plugin from the configuration; ${SKIP_HINT}` };
  return undefined;
}

/** The moddleExtensions that name a module path: JSON from the project, else the plugin's descriptors for camunda / zeebe. */
function moddleExtensionsOf(config: BpmnlintConfig, rcDir: string, l: Libs, from?: string): { found: Record<string, object>; unavailable: BpmnlintUnavailable[] } {
  const found: Record<string, object> = {};
  const unavailable: BpmnlintUnavailable[] = [];
  const root = rootOf(rcDir);
  const req = createRequire(join(rcDir, '__bpmn-cli__.js'));
  for (const [prefix, value] of moddleEntries(config)) {
    if (typeof value !== 'string') continue;
    let path: string | undefined;
    for (const id of extname(value) ? [value] : [value, `${value}.json`]) {
      try {
        path = req.resolve(id);
        break;
      } catch {
        /* the next spelling */
      }
    }
    if (path !== undefined && inside(path, root)) {
      if (!path.endsWith('.json')) {
        unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `only JSON descriptors are loaded (${shown(path, from)})`, hint: 'Name the JSON descriptor (e.g. camunda-bpmn-moddle/resources/camunda.json); bpmn-cli runs no moddle modules.' });
        continue;
      }
      try {
        found[prefix] = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as object;
      } catch (err) {
        unavailable.push({ kind: 'moddle', name: prefix, pkg: value, reason: `cannot be read (${firstLine(err)})`, hint: 'Fix the descriptor, or remove the moddleExtensions entry.' });
      }
      continue;
    }
    const known = KNOWN_MODDLE[value.replace(/\.json$/, '')];
    const descriptor = known ? (l.plugin.getDefaultLintConfig({ engine: known.engine }).moddleExtensions?.[known.prefix] as object | undefined) : undefined;
    if (descriptor) {
      found[prefix] = descriptor;
      continue;
    }
    unavailable.push({
      kind: 'moddle',
      name: prefix,
      pkg: value,
      reason: `not installed (looked up from ${shown(rcDir, from)}); bpmn-cli brings camunda-bpmn-moddle/resources/camunda.json and zeebe-bpmn-moddle/resources/zeebe.json only`,
      hint: 'Install its package next to the .bpmnlintrc, or remove the moddleExtensions entry.',
    });
  }
  return { found, unavailable };
}

/** A loaded .bpmnlintrc, or why bpmnlint cannot run with it (a broken file, bpmnlint or the plugin not loadable). */
export type LoadedBpmnlint =
  | {
      ok: true;
      path: string;
      /** where it is, as messages name it: `.bpmnlintrc in models`, `--lint-config lint/strict.json` */
      where: string;
      /** bpmnlint's Linter and the resolver chain (`used`: which tier answered what) */
      engine: BpmnlintEngine & { resolver: BpmnlintChain };
      resolved: ResolvedBpmnlintConfig;
      /** left out besides the configuration's own (moddle extensions) */
      notes: BpmnlintUnavailable[];
      /** project plugins that ran (`name@version`) */
      project: string[];
      /** the validator line's detail: where the .bpmnlintrc is, project plugins, how much is left out (W_LINT_UNAVAILABLE), a bpmnlint other than the pinned one */
      detail: string;
    }
  | { ok: false; path: string; where: string; unavailable: BpmnlintUnavailable[]; detail: string };

const cache = new Map<string, { text: string; loaded: Promise<LoadedBpmnlint> }>();

/**
 * Reads and resolves a .bpmnlintrc (cached on its text). `explicit`
 * (--lint-config): a file that cannot be read or is not strict JSON is
 * E_LINT_CONFIG; a discovered one is W_LINT_UNAVAILABLE and bpmnlint does not
 * run. `projectCode`: the project tier; `from`: the base of shown paths.
 */
export async function loadBpmnlint(rcPath: string, opts: { explicit?: boolean; projectCode?: boolean; from?: string } = {}): Promise<LoadedBpmnlint> {
  const abs = resolve(rcPath);
  const where = opts.explicit ? `--lint-config ${shown(abs, opts.from)}` : `${BPMNLINT_CONFIG_FILE} in ${shown(dirname(abs), opts.from)}`;
  const broken = (reason: string, hint: string): LoadedBpmnlint => {
    if (opts.explicit) throw ioError('E_LINT_CONFIG', `Cannot use the bpmnlint configuration ${rcPath}: ${reason}`, { file: rcPath, hint: 'Pass an existing .bpmnlintrc in strict JSON to --lint-config, or --no-lint-config.' });
    return { ok: false, path: abs, where, unavailable: [{ kind: 'file', name: abs, pkg: abs, reason, hint }], detail: `${where}; bpmnlint did not run (bpmn validate lists why)` };
  };
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    return broken(`${shown(abs, opts.from)} cannot be read (${firstLine(err)})`, `Fix its permissions; ${SKIP_HINT}`);
  }
  let config: BpmnlintConfig;
  try {
    config = JSON.parse(text.replace(/^﻿/, '')) as BpmnlintConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a JSON object');
  } catch (err) {
    return broken(`${shown(abs, opts.from)} is not JSON (${firstLine(err)}; bpmnlint reads it with JSON.parse: no comments, no trailing commas)`, `Write it as strict JSON, as bpmnlint reads it; ${SKIP_HINT}`);
  }
  // the repository decides about project code: a .git that appears, goes or changes its owner is another load
  const repo = repoOf(dirname(abs));
  const key = [abs, !!opts.explicit, !!opts.projectCode, opts.from ?? '', repo ? `${repo.root}:${repo.off ?? ''}` : ''].join('|');
  const hit = cache.get(key);
  if (hit && hit.text === text) return hit.loaded;
  const loaded = load(abs, config, where, repo, opts);
  cache.set(key, { text, loaded });
  loaded.catch(() => cache.delete(key));
  return loaded;
}

async function load(abs: string, config: BpmnlintConfig, where: string, repo: Repo | undefined, opts: { projectCode?: boolean; from?: string }): Promise<LoadedBpmnlint> {
  const notRun = `${where}; bpmnlint did not run (bpmn validate lists why)`;
  const l = loadLibs();
  if (isFailure(l)) return { ok: false, path: abs, where, unavailable: [engineUnavailable(l, opts.from)], detail: notRun };
  // everything that loads or resolves in one try: whatever throws, the write goes ahead with one W_LINT_UNAVAILABLE
  try {
    const rcDir = dirname(abs);
    const chain = new ChainResolver(l, rcDir, opts, repo);
    const engine = { Linter: l.Linter, resolver: chain };
    const moddle = moddleExtensionsOf(config, rcDir, l, opts.from);
    const resolved = await resolveBpmnlintConfig(engine, config, { moddleExtensions: moddle.found });
    const project = chain.projectPackages().map((pkg) => {
      const v = chain.projectVersion(pkg);
      return v ? `${pkg}@${v}` : pkg;
    });
    const parts = [where];
    if (project.length) parts.push(`project plugins: ${project.join(', ')}`);
    // a write only counts the W_LINT_UNAVAILABLE findings (the same before and after): its validator line says they are there
    const left = bpmnlintUnavailableFindings([...resolved.unavailable, ...moddle.unavailable]).length;
    if (left) parts.push(`${left} left out (W_LINT_UNAVAILABLE; bpmn validate lists ${left === 1 ? 'it' : 'them'})`);
    if (l.bpmnlint.version !== l.pinned) parts.push(`bpmnlint ${l.bpmnlint.version} from ${shown(l.bpmnlint.dir, opts.from)} (bpmn-cli pins ${l.pinned})`);
    return { ok: true, path: abs, where, engine, resolved, notes: moddle.unavailable, project, detail: parts.join('; ') };
  } catch (err) {
    return { ok: false, path: abs, where, unavailable: [engineUnavailable({ ...l, message: firstLine(err) }, opts.from)], detail: notRun };
  }
}

/** The .bpmnlintrc that applies (see the module header), or undefined. */
function lintConfigOf(file: string | undefined, opts: FileBpmnlintOptions): { path: string; explicit: boolean } | undefined {
  if (opts.lintConfig === false) return undefined;
  if (typeof opts.lintConfig === 'string') return { path: resolve(opts.lintFrom ?? '', opts.lintConfig), explicit: true };
  const start = file !== undefined ? dirname(resolve(file)) : opts.lintFrom;
  const found = start !== undefined ? findBpmnlintConfig(start) : undefined;
  return found ? { path: found, explicit: false } : undefined;
}

/** The id conventions of a loaded .bpmnlintrc (idConventionsFromLint on its element-id-naming), computed once per load. */
const idConventionsCache = new WeakMap<ResolvedBpmnlintConfig, ProjectIdConventions>();

function idConventionsOf(loaded: LoadedBpmnlint & { ok: true }): ProjectIdConventions {
  const hit = idConventionsCache.get(loaded.resolved);
  if (hit) return hit;
  const setting = loaded.resolved.rules[ID_NAMING_RULE];
  const l = loadLibs();
  const out: ProjectIdConventions = { notes: [], where: loaded.where, ...(setting ? { setting } : {}) };
  if (setting && setting.severity !== 'off' && !isFailure(l)) Object.assign(out, idConventionsFromLint(setting, l.plugin.naming, { source: loaded.where }));
  idConventionsCache.set(loaded.resolved, out);
  return out;
}

/** The validator line's note on what element-id-naming declares and new ids cannot follow (a write only counts those notes). */
function ignoredDetail(notes: readonly ValidatorFinding[]): string {
  return notes.length ? `; ${notes.length} element-id-naming value${notes.length === 1 ? '' : 's'} ignored (W_CONFIG_IGNORED; bpmn validate lists ${notes.length === 1 ? 'it' : 'them'})` : '';
}

/**
 * The project's bpmnlint for a file (the one written or checked; without one
 * the lookup starts at `lintFrom`): its validator and the id conventions its
 * element-id-naming declares; nothing with no .bpmnlintrc, `lintConfig:
 * false`, or `validators` that already hold one named bpmnlint (the host's,
 * who passes the conventions of its own configuration).
 */
export async function projectLint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {}): Promise<{ validator?: NamedValidator; conventions?: IdConventions }> {
  if (opts.validators?.some((v) => (typeof v === 'function' ? v.name : v?.name) === BPMNLINT_VALIDATOR)) return {};
  const rc = lintConfigOf(file, opts);
  if (!rc) return {};
  const loaded = await loadBpmnlint(rc.path, { explicit: rc.explicit, projectCode: opts.lintProjectCode, from: opts.lintFrom });
  const blocks = opts.lintBlocks ?? false;
  if (!loaded.ok) {
    const findings = bpmnlintUnavailableFindings(loaded.unavailable);
    return { validator: { name: BPMNLINT_VALIDATOR, detail: loaded.detail, blocks, validate: () => findings } };
  }
  const ids = idConventionsOf(loaded);
  const validator = bpmnlintValidator(loaded.engine, loaded.resolved, { detail: `${loaded.detail}${ignoredDetail(ids.notes)}`, blocks, unavailable: loaded.notes, notes: ids.notes });
  return { validator, ...(ids.conventions ? { conventions: ids.conventions } : {}) };
}

/**
 * The bpmnlint validator for a file (the one written or checked; without one
 * the lookup starts at `lintFrom`), or undefined: no .bpmnlintrc, `lintConfig:
 * false`, or `validators` already hold one named bpmnlint (the host's).
 */
export async function projectBpmnlint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] } = {}): Promise<NamedValidator | undefined> {
  return (await projectLint(file, opts)).validator;
}

/** What the .bpmnlintrc of a file declares about ids (projectIdConventions). */
export interface ProjectIdConventions {
  /** the id conventions of its element-id-naming (src/conventions.ts); absent: the rule is off or not configured, or every prefix is switched off */
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

/**
 * The id conventions the .bpmnlintrc that applies to a file declares through
 * @miragon/rules/element-id-naming (src/conventions.ts idConventionsFromLint
 * with the plugin's own naming helpers): the same lookup, flags and cache as
 * projectBpmnlint; undefined without a .bpmnlintrc or with `lintConfig:
 * false`. The notes list what `validate` lists about the configuration: its
 * W_CONFIG_IGNORED, and a W_LINT_UNAVAILABLE for what it leaves out (a rule
 * name with a typo leaves element-id-naming out) or for a .bpmnlintrc that
 * cannot be loaded (`unavailable`, no conventions).
 */
export async function projectIdConventions(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<ProjectIdConventions | undefined> {
  const rc = lintConfigOf(file, opts);
  if (!rc) return undefined;
  const loaded = await loadBpmnlint(rc.path, { explicit: rc.explicit, projectCode: opts.lintProjectCode, from: opts.lintFrom });
  if (!loaded.ok) return { notes: bpmnlintUnavailableFindings(loaded.unavailable), where: loaded.where, unavailable: true };
  const ids = idConventionsOf(loaded);
  // a new object: the cached one's notes are the validator's, which a write counts as W_CONFIG_IGNORED
  const left = bpmnlintUnavailableFindings([...loaded.resolved.unavailable, ...loaded.notes]);
  return left.length ? { ...ids, notes: [...ids.notes, ...left] } : ids;
}

/** The effective bpmnlint settings for a file (projectBpmnlintSettings). */
export interface BpmnlintSettings {
  /** the .bpmnlintrc */
  path: string;
  detail: string;
  /** normalised rule name -> severity and options; `off` included; a rule that cannot be resolved is not here but in `unavailable` */
  rules: Record<string, BpmnlintRuleSetting>;
  unavailable: BpmnlintUnavailable[];
}

/**
 * The effective rule settings of the .bpmnlintrc that applies to a file:
 * the same lookup, flags, cache and errors as projectBpmnlint (a broken
 * discovered file gives no rules and the file in `unavailable`); undefined
 * without a .bpmnlintrc or with `lintConfig: false`.
 */
export async function projectBpmnlintSettings(file: string | undefined, opts: FileBpmnlintOptions = {}): Promise<BpmnlintSettings | undefined> {
  const rc = lintConfigOf(file, opts);
  if (!rc) return undefined;
  const loaded = await loadBpmnlint(rc.path, { explicit: rc.explicit, projectCode: opts.lintProjectCode, from: opts.lintFrom });
  if (!loaded.ok) return { path: loaded.path, detail: loaded.detail, rules: {}, unavailable: loaded.unavailable };
  return { path: loaded.path, detail: loaded.detail, rules: loaded.resolved.rules, unavailable: [...loaded.resolved.unavailable, ...loaded.notes] };
}

import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import type { BpmnlintResolver } from '../validate/bpmnlint-validator.js';
import type { BpmnlintLibs } from './BpmnlintLibs.js';
import type { Repo } from './RepoTrust.js';
import { lazy, SHIPPED, SKIP_HINT, versionOf, type Require } from './utils/bpmnlint.js';
import { depState, type Dep } from './utils/dependencies.js';
import { inside, shown } from './utils/paths.js';
import { firstLine } from '../shared/utils/text.js';

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

/** A module of the project that failed to load: the first line of its error, and its depState before the require. */
interface LoadFailureOf {
  message: string;
  state: string;
}

/**
 * The resolver chain of a .bpmnlintrc. It asks, per rule and config, until
 * one tier answers (then it remembers the answer; lint runs never ask the
 * tiers again):
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
 *     user running bpmn-cli, checked as git checks it (RepoTrust: the
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
 */
export class ChainResolver implements BpmnlintChain {
  readonly used = new Map<string, BpmnlintTier>();
  private readonly answers = new Map<string, unknown>();
  /** packages whose config the project tier answered: their rules come from there first */
  private readonly pinned = new Set<string>();
  /** modules of the project that failed to load (absolute path -> first line of the error, depState before the require) */
  private readonly loadFailures = new Map<string, LoadFailureOf>();
  /** packages a rule or config was left out for (reason), but bpmnlint */
  private readonly leftOut = new Set<string>();
  /** each package's depState before a tier first looked it up (the state of a package left out) */
  private readonly before = new Map<string, string>();
  private readonly tiers: Tier[];
  /** why the project tier does not run although the host asked for it (no repository, one that is not the user's: offReason), or undefined */
  private readonly off: { why: string; hint: string } | undefined;
  /** the same reason whether or not the host asked: lintProjectCode would not help */
  private readonly repoOff: { why: string; hint: string } | undefined;

  /**
   * `root`: the repository root of the .bpmnlintrc's directory (the directory
   * itself outside a repository), without symlinks like the paths Node resolves.
   */
  constructor(
    private readonly libs: BpmnlintLibs,
    private readonly rcDir: string,
    private readonly root: string,
    private readonly opts: { projectCode?: boolean; from?: string },
    repo: Repo | undefined,
  ) {
    this.repoOff = this.offReason(repo);
    this.off = opts.projectCode ? this.repoOff : undefined;
    this.tiers = [
      { name: 'bundled', accepts: () => true, get: lazy(() => libs.bundledResolver()) },
      { name: 'shipped', accepts: (pkg) => SHIPPED.has(pkg), get: lazy(() => libs.shippedResolver()) },
      { name: 'project', accepts: (pkg) => !!opts.projectCode && !this.off && pkg !== 'bpmnlint', get: lazy(() => libs.projectResolver(this.boundedRequire(this.loadFailures))) },
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
    return versionOf(this.boundedRequire(new Map()), pkg)?.version;
  }

  /**
   * What the answers depended on in the project (LoadDeps): every package a
   * rule or config was left out for (but bpmnlint, which is bpmn-cli's) and
   * every module of the project that failed to load, each with its state
   * before the tiers looked it up.
   */
  projectDeps(): Dep[] {
    return [...[...this.leftOut].map((pkg) => ({ ids: [pkg], state: this.before.get(pkg)! })), ...[...this.loadFailures].map(([file, f]) => ({ ids: [file], state: f.state }))];
  }

  private async first(kind: 'rule' | 'config', pkg: string, name: string): Promise<unknown> {
    const key = `${kind}:${pkg}/${name}`;
    if (this.answers.has(key)) return this.answers.get(key);
    // before any tier looks: an install that lands while they do is a change the cache sees (only a package left out keeps it)
    if (pkg !== 'bpmnlint' && !this.before.has(pkg)) this.before.set(pkg, depState(this.rcDir, [pkg]));
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
    // an install, a removal or a fix of the package changes the answer: the cache checks it (LoadDeps)
    this.leftOut.add(pkg);
    // where Node finds the package from the .bpmnlintrc (only to tell "not installed" from "outside the repository"; nothing is loaded)
    let path: string | undefined;
    try {
      path = createRequire(join(this.rcDir, '__bpmn-cli__.js')).resolve(pkg);
    } catch {
      path = undefined;
    }
    const projectRuns = !!this.opts.projectCode && !this.off && path !== undefined && inside(path, this.root);
    if (SHIPPED.has(pkg) && !projectRuns) {
      const v = this.libs.shippedVersion(pkg);
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
    if (failed) return fail(`${pkg} fails to load: ${failed[1].message}`, `Fix or reinstall ${pkg}; ${SKIP_HINT}`);
    return fail(`${pkg} has no ${kind} ${name}`, `Check the name and the installed version of ${pkg}.`);
  }

  /** Why the project tier does not run for a .bpmnlintrc in `rcDir` (the host asked for it, or would not help by asking): no git repository, or one that does not count as the user's (RepoTrust). */
  private offReason(repo: Repo | undefined): { why: string; hint: string } | undefined {
    const from = this.opts.from;
    if (!repo) return { why: `bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in ${shown(this.rcDir, from)} is in none)`, hint: `Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; ${SKIP_HINT}` };
    const git = shown(join(repo.root, '.git'), from);
    if (repo.off === 'owner') return { why: `bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`, hint: `Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; ${SKIP_HINT}` };
    if (repo.off === 'gitfile') return { why: `bpmn-cli runs project plugins only inside a git repository (${git} is a file that names no git directory, so git takes it for no repository either)`, hint: `Fix or remove that .git file (a worktree or submodule whose git directory moved), or remove the plugin from the configuration; ${SKIP_HINT}` };
    if (repo.off === 'home') return { why: `bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)`, hint: `Keep the repository inside your home directory, or remove the plugin from the configuration; ${SKIP_HINT}` };
    return undefined;
  }

  /** A require that loads entry modules only from inside the repository root, and records what failed to load (absolute path -> LoadFailureOf). */
  private boundedRequire(failures: Map<string, LoadFailureOf>): Require {
    const req = createRequire(join(this.rcDir, '__bpmn-cli__.js')) as Require;
    const check = (id: string): string => {
      const path = req.resolve(id);
      if (!inside(path, this.root)) throw new Error(`${id} resolves outside the repository (${path})`);
      return path;
    };
    const bounded = ((id: string) => {
      const path = check(id);
      // before the require: a fix written while it runs is a change the cache sees
      const state = depState(this.rcDir, [path]);
      try {
        return req(path);
      } catch (err) {
        failures.set(path, { message: firstLine(err), state });
        throw err;
      }
    }) as Require;
    bounded.resolve = check;
    return bounded;
  }

  /** The rule `name` bundled in another package, as a .bpmnlintrc writes it (`@miragon/rules/element-id-naming`). */
  private bundledName(pkg: string, name: string): string | undefined {
    const key = Object.keys(this.libs.plugin.bundledResolverEntries).find((k) => k.startsWith('rule:') && k.endsWith(`/${name}`) && k !== `rule:${pkg}/${name}`);
    if (!key) return undefined;
    const owner = key.slice('rule:'.length, key.length - name.length - 1);
    return owner === 'bpmnlint' ? name : `${owner.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${name}`;
  }
}

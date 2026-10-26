import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import type { BpmnlintResolver } from '../validate/bpmnlint-validator.js';
import type { BpmnlintLibs } from './BpmnlintLibs.js';
import type { Repo } from './RepoTrust.js';
import { lazy, SHIPPED, SKIP_HINT, versionOf, type Require } from './utils/bpmnlint.js';
import { depState, type Dep } from './utils/dependencies.js';
import { inside, shown } from './utils/paths.js';
import { firstLine } from '../shared/utils/text.js';

export type BpmnlintTier = 'bundled' | 'shipped' | 'project';

/** The resolver of a .bpmnlintrc; `used` maps `rule:<pkg>/<name>` to the tier that answered. */
export interface BpmnlintChain extends BpmnlintResolver {
  readonly used: ReadonlyMap<string, BpmnlintTier>;
}

interface Tier {
  name: BpmnlintTier;
  accepts(pkg: string): boolean;
  get(): BpmnlintResolver;
}

interface LoadFailureOf {
  message: string;
  state: string;
}

/**
 * The resolver chain of a .bpmnlintrc: bundled rules, then what the plugin ships, then the
 * project's own packages. The project tier is the only one that runs project code, and only
 * inside a git repository of the current user with entry modules inside the repository root.
 */
export class ChainResolver implements BpmnlintChain {
  readonly used = new Map<string, BpmnlintTier>();
  private readonly answers = new Map<string, unknown>();
  /** packages whose config the project tier answered: one version per package */
  private readonly pinned = new Set<string>();
  private readonly loadFailures = new Map<string, LoadFailureOf>();
  private readonly leftOut = new Set<string>();
  private readonly before = new Map<string, string>();
  private readonly tiers: Tier[];
  private readonly off: { why: string; hint: string } | undefined;
  /** the same reason whether or not the host asked: lintProjectCode would not help */
  private readonly repoOff: { why: string; hint: string } | undefined;

  /** `root` has no symlinks, like the paths Node resolves. */
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

  projectPackages(): string[] {
    return [...new Set([...this.used].filter(([, tier]) => tier === 'project').map(([key]) => key.slice(key.indexOf(':') + 1, key.lastIndexOf('/'))))];
  }

  projectVersion(pkg: string): string | undefined {
    return versionOf(this.boundedRequire(new Map()), pkg)?.version;
  }

  projectDeps(): Dep[] {
    return [...[...this.leftOut].map((pkg) => ({ ids: [pkg], state: this.before.get(pkg)! })), ...[...this.loadFailures].map(([file, failure]) => ({ ids: [file], state: failure.state }))];
  }

  private async first(kind: 'rule' | 'config', pkg: string, name: string): Promise<unknown> {
    const key = `${kind}:${pkg}/${name}`;
    if (this.answers.has(key)) return this.answers.get(key);
    // recorded before any tier looks, so an install landing meanwhile still invalidates the cache
    if (pkg !== 'bpmnlint' && !this.before.has(pkg)) this.before.set(pkg, depState(this.rcDir, [pkg]));
    const tiers = this.pinned.has(pkg) ? [...this.tiers.filter((tier) => tier.name === 'project'), ...this.tiers.filter((tier) => tier.name !== 'project')] : this.tiers;
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

  private reason(kind: 'rule' | 'config', pkg: string, name: string): Error {
    const fail = (message: string, hint: string) => Object.assign(new Error(message), { hint });
    const where = shown(this.rcDir, this.opts.from);
    if (pkg === 'bpmnlint') {
      const version = this.libs.bpmnlint.version;
      return fail(`bpmnlint ${version} has no ${kind} ${name}`, `bpmn-cli runs bpmnlint ${version}; update bpmn-cli or remove the ${kind}.`);
    }
    this.leftOut.add(pkg);
    // resolved only to tell "not installed" from "outside the repository"; nothing is loaded
    let path: string | undefined;
    try {
      path = createRequire(join(this.rcDir, '__bpmn-cli__.js')).resolve(pkg);
    } catch {
      path = undefined;
    }
    const projectRuns = !!this.opts.projectCode && !this.off && path !== undefined && inside(path, this.root);
    if (SHIPPED.has(pkg) && !projectRuns) {
      const version = this.libs.shippedVersion(pkg);
      const bundled = `${pkg}${version ? ` ${version}` : ''} (bundled with bpmn-cli) has no ${kind} ${name}`;
      if (path !== undefined && inside(path, this.root)) {
        if (this.off) return fail(`${bundled}, and ${this.off.why}`, this.off.hint);
        return fail(`${bundled}, and this host does not run project plugins (lintProjectCode)`, this.repoOff ? `Check the name; lintProjectCode: true would not load the ${pkg} installed next to the .bpmnlintrc either: ${this.repoOff.why}.` : `Check the name, or let the host pass lintProjectCode: true to use the ${pkg} installed in the repository.`);
      }
      if (this.off) return fail(bundled, `Check the name; ${this.off.why}.`);
        if (!this.opts.projectCode) return fail(bundled, this.repoOff ? `Check the name; a newer ${pkg} installed next to the .bpmnlintrc would not be used either: this host does not run project plugins (lintProjectCode), and ${this.repoOff.why}.` : `Check the name; a newer ${pkg} installed in the repository next to the .bpmnlintrc is used only when the host passes lintProjectCode: true.`);
      return fail(bundled, `Check the name. A newer ${pkg} installed in the repository next to the .bpmnlintrc is used for what the bundled one does not know.`);
    }
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

  private offReason(repo: Repo | undefined): { why: string; hint: string } | undefined {
    const from = this.opts.from;
    if (!repo) return { why: `bpmn-cli runs project plugins only inside a git repository (the .bpmnlintrc in ${shown(this.rcDir, from)} is in none)`, hint: `Keep the .bpmnlintrc and the plugin in a git repository, or remove the plugin from the configuration; ${SKIP_HINT}` };
    const git = shown(join(repo.root, '.git'), from);
    if (repo.off === 'owner') return { why: `bpmn-cli runs project plugins only in a repository of the user running it (the repository of ${git} belongs to another user)`, hint: `Check who created that repository and its .git; run bpmn-cli as its owner (git's safe.directory does not change this), or remove the plugin from the configuration; ${SKIP_HINT}` };
    if (repo.off === 'gitfile') return { why: `bpmn-cli runs project plugins only inside a git repository (${git} is a file that names no git directory, so git takes it for no repository either)`, hint: `Fix or remove that .git file (a worktree or submodule whose git directory moved), or remove the plugin from the configuration; ${SKIP_HINT}` };
    if (repo.off === 'home') return { why: `bpmn-cli runs project plugins only in a repository of the user running it, and where it cannot read file owners (Windows) only in one inside the home directory (${git} is outside it)`, hint: `Keep the repository inside your home directory, or remove the plugin from the configuration; ${SKIP_HINT}` };
    return undefined;
  }

  /** A require that loads entry modules only from inside the repository root. */
  private boundedRequire(failures: Map<string, LoadFailureOf>): Require {
    const req = createRequire(join(this.rcDir, '__bpmn-cli__.js')) as Require;
    const check = (id: string): string => {
      const path = req.resolve(id);
      if (!inside(path, this.root)) throw new Error(`${id} resolves outside the repository (${path})`);
      return path;
    };
    const bounded = ((id: string) => {
      const path = check(id);
      // taken before the require, so a fix written while it runs still invalidates the cache
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

  private bundledName(pkg: string, name: string): string | undefined {
    const key = Object.keys(this.libs.plugin.bundledResolverEntries).find((entryKey) => entryKey.startsWith('rule:') && entryKey.endsWith(`/${name}`) && entryKey !== `rule:${pkg}/${name}`);
    if (!key) return undefined;
    const owner = key.slice('rule:'.length, key.length - name.length - 1);
    return owner === 'bpmnlint' ? name : `${owner.replace(/(^|\/)bpmnlint-plugin-/, '$1')}/${name}`;
  }
}

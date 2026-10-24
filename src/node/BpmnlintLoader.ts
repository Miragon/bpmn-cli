import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BpmnlintConfig, BpmnlintEngine, BpmnlintUnavailable, ResolvedBpmnlintConfig } from '../validate/bpmnlint-validator.js';
import { BpmnlintConfigResolution } from '../validate/BpmnlintConfigResolution.js';
import { bpmnlintUnavailableFindings } from '../validate/utils/bpmnlint.js';
import { BpmnlintLibs } from './BpmnlintLibs.js';
import { ChainResolver, type BpmnlintChain } from './ChainResolver.js';
import { BPMNLINT_CONFIG_FILE } from './ConfigLookup.js';
import { gitRoot } from './utils/find-up.js';
import { LoadCache } from './LoadCache.js';
import { ModdleExtensions } from './ModdleExtensions.js';
import { RepoTrust, type Repo } from './RepoTrust.js';
import { engineUnavailable, SKIP_HINT } from './utils/bpmnlint.js';
import type { LoadDeps } from './utils/dependencies.js';
import { real, shown } from './utils/paths.js';
import { ioError } from '../shared/utils/errors.js';
import { firstLine } from '../shared/utils/text.js';

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

/**
 * Reads and resolves a .bpmnlintrc with its resolver chain (cached in
 * LoadCache). `explicit` (--lint-config): a file that cannot be read or is
 * not strict JSON is E_LINT_CONFIG; a discovered one is W_LINT_UNAVAILABLE and
 * bpmnlint does not run. `projectCode`: the project tier; `from`: the base of
 * shown paths.
 */
export class BpmnlintLoader {
  private readonly abs: string;
  private readonly where: string;

  constructor(
    private readonly rcPath: string,
    private readonly opts: { explicit?: boolean; projectCode?: boolean; from?: string } = {},
  ) {
    this.abs = resolve(rcPath);
    this.where = opts.explicit ? `--lint-config ${shown(this.abs, opts.from)}` : `${BPMNLINT_CONFIG_FILE} in ${shown(dirname(this.abs), opts.from)}`;
  }

  async load(): Promise<LoadedBpmnlint> {
    const { abs, opts } = this;
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      return this.broken(`${shown(abs, opts.from)} cannot be read (${firstLine(err)})`, `Fix its permissions; ${SKIP_HINT}`);
    }
    let config: BpmnlintConfig;
    try {
      config = JSON.parse(text.replace(/^﻿/, '')) as BpmnlintConfig;
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a JSON object');
    } catch (err) {
      return this.broken(`${shown(abs, opts.from)} is not JSON (${firstLine(err)}; bpmnlint reads it with JSON.parse: no comments, no trailing commas)`, `Write it as strict JSON, as bpmnlint reads it; ${SKIP_HINT}`);
    }
    // the repository decides about project code: a .git that appears, goes or changes its owner is another load
    const repo = new RepoTrust().repoOf(dirname(abs));
    const key = [abs, !!opts.explicit, !!opts.projectCode, opts.from ?? '', repo ? `${repo.root}:${repo.off ?? ''}` : ''].join('|');
    return LoadCache.shared.loaded(key, text, dirname(abs), () => this.resolve(config, repo));
  }

  private broken(reason: string, hint: string): LoadedBpmnlint {
    if (this.opts.explicit) throw ioError('E_LINT_CONFIG', `Cannot use the bpmnlint configuration ${this.rcPath}: ${reason}`, { file: this.rcPath, hint: 'Pass an existing .bpmnlintrc in strict JSON to --lint-config, or --no-lint-config.' });
    return { ok: false, path: this.abs, where: this.where, unavailable: [{ kind: 'file', name: this.abs, pkg: this.abs, reason, hint }], detail: `${this.where}; bpmnlint did not run (bpmn validate lists why)` };
  }

  private async resolve(config: BpmnlintConfig, repo: Repo | undefined): Promise<{ loaded: LoadedBpmnlint; deps: LoadDeps }> {
    const { abs, where, opts } = this;
    const notRun = `${where}; bpmnlint did not run (bpmn validate lists why)`;
    const l = BpmnlintLibs.load();
    if (!(l instanceof BpmnlintLibs)) return { loaded: { ok: false, path: abs, where, unavailable: [engineUnavailable(l, opts.from)], detail: notRun }, deps: [] };
    // everything that loads or resolves in one try: whatever throws, the write goes ahead with one W_LINT_UNAVAILABLE
    try {
      const rcDir = dirname(abs);
      const root = real(gitRoot(rcDir) ?? rcDir);
      const chain = new ChainResolver(l, rcDir, root, opts, repo);
      const engine = { Linter: l.Linter, resolver: chain };
      const moddle = new ModdleExtensions(config, rcDir, root, l, opts.from);
      const resolved = await new BpmnlintConfigResolution(engine, config, { moddleExtensions: moddle.found }).resolve();
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
      return { loaded: { ok: true, path: abs, where, engine, resolved, notes: moddle.unavailable, project, detail: parts.join('; ') }, deps: [...chain.projectDeps(), ...moddle.deps] };
    } catch (err) {
      return { loaded: { ok: false, path: abs, where, unavailable: [engineUnavailable({ message: firstLine(err), bpmnlint: l.bpmnlint, pinned: l.pinned }, opts.from)], detail: notRun }, deps: [] };
    }
  }
}

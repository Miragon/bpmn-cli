import { createRequire } from 'node:module';
import type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinterClass, BpmnlintResolver } from '../validate/bpmnlint-validator.js';
import type { IdNamingHelpers } from '../ids/IdConventionsReader.js';
import { engineUnavailable, lazy, PLUGIN, SHIPPED, versionOf, type LoadFailure, type Require } from './utils/bpmnlint.js';
import { firstLine } from '../shared/utils/text.js';

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

type NodeResolverClass = new (options: { require: Require }) => BpmnlintResolver;

/**
 * bpmnlint and @miragon/bpmnlint-plugin-rules (exact dependencies of
 * bpmn-cli), required on the first .bpmnlintrc with createRequire (the
 * plugin's CJS build): synchronously (bpmnlintEngine() is synchronous), and
 * with Linter and NodeResolver required from the plugin's own location, so
 * they come from the bpmnlint the plugin's rules import: rules and linter are
 * one bpmnlint even when a project's hoisted bpmnlint is the one the plugin
 * finds (the detail line names a version other than the pinned one), and
 * NodeResolver resolves the shipped tier with CJS resolution from inside the
 * plugin. Loading fails (a bpmnlint older than 11.14 next to the plugin, which
 * npm avoids since the plugin's peer range `>=11.14.0` but an install with
 * --legacy-peer-deps does not; a broken install): W_LINT_UNAVAILABLE, the
 * write goes ahead. The outcome is kept for the life of the process.
 */
export class BpmnlintLibs {
  private static loaded: BpmnlintLibs | LoadFailure | undefined;

  private constructor(
    readonly Linter: BpmnlintLinterClass,
    private readonly NodeResolver: NodeResolverClass,
    readonly plugin: BpmnlintPlugin & { bundledResolverEntries: Record<string, unknown> },
    /** require from inside the plugin package (its own dependency tree) */
    private readonly pluginRequire: Require,
    /** the bpmnlint the plugin loads */
    readonly bpmnlint: { version: string; dir: string },
    /** the bpmnlint version bpmn-cli pins */
    readonly pinned: string,
  ) {}

  static load(): BpmnlintLibs | LoadFailure {
    if (BpmnlintLibs.loaded) return BpmnlintLibs.loaded;
    const req = createRequire(import.meta.url) as Require;
    let used: { version: string; dir: string } | undefined;
    let pinned: string | undefined;
    try {
      pinned = versionOf(req, 'bpmnlint')?.version;
      const pluginMain = req.resolve(PLUGIN);
      const pluginRequire = createRequire(pluginMain) as Require;
      used = versionOf(pluginRequire, 'bpmnlint');
      const plugin = req(pluginMain) as BpmnlintLibs['plugin'];
      const { Linter } = pluginRequire('bpmnlint') as { Linter: BpmnlintLinterClass };
      const NodeResolver = pluginRequire('bpmnlint/lib/resolver/node-resolver') as NodeResolverClass;
      if (typeof plugin.createBundledResolver !== 'function' || typeof Linter !== 'function') throw new Error(`${PLUGIN} or bpmnlint has an unexpected shape`);
      BpmnlintLibs.loaded = new BpmnlintLibs(Linter, NodeResolver, plugin, pluginRequire, used ?? { version: '?', dir: '' }, pinned ?? '?');
    } catch (err) {
      BpmnlintLibs.loaded = { message: firstLine(err), ...(used ? { bpmnlint: used } : {}), ...(pinned ? { pinned } : {}) };
    }
    return BpmnlintLibs.loaded;
  }

  /**
   * bpmnlint's Linter with the offline tiers of the resolver chain
   * (offlineResolver: every config and rule bpmn-cli ships, as a .bpmnlintrc
   * gets them, no project code), and the plugin (`getDefaultLintConfig`,
   * `naming`): what a library host builds a validator from without a
   * .bpmnlintrc. Throws an Error that names the bpmnlint versions when the
   * libraries cannot be loaded.
   */
  static engine(): BpmnlintEngine & { plugin: BpmnlintPlugin; bpmnlintVersion: string } {
    const l = BpmnlintLibs.load();
    if (!(l instanceof BpmnlintLibs)) {
      const u = engineUnavailable(l);
      throw new Error(`${u.reason} (${u.hint})`);
    }
    return { Linter: l.Linter, resolver: l.offlineResolver(), plugin: l.plugin, bpmnlintVersion: l.bpmnlint.version };
  }

  bundledResolver(): BpmnlintResolver {
    return this.plugin.createBundledResolver();
  }

  shippedResolver(): BpmnlintResolver {
    return new this.NodeResolver({ require: this.pluginRequire });
  }

  projectResolver(require: Require): BpmnlintResolver {
    return new this.NodeResolver({ require });
  }

  shippedVersion(pkg: string): string | undefined {
    return versionOf(this.pluginRequire, pkg)?.version;
  }

  /**
   * Tiers 1 and 2 of the chain, synchronous like the bundled resolver: the
   * plugin's bundled resolver, then, for the packages bpmn-cli ships, bpmnlint's
   * NodeResolver from inside the plugin (every camunda-compat config and rule
   * of the version it pins: camunda-cloud-8-5, camunda-platform-7-20). Offline,
   * no project code. What neither answers throws the bundled resolver's error
   * (`unknown config <pkg/name>`).
   */
  private offlineResolver(): BpmnlintResolver {
    const bundled = this.bundledResolver();
    const shipped = lazy(() => this.shippedResolver());
    const ask = (kind: 'rule' | 'config', pkg: string, name: string): unknown => {
      const of = (r: BpmnlintResolver) => (kind === 'rule' ? r.resolveRule(pkg, name) : r.resolveConfig(pkg, name));
      try {
        return of(bundled);
      } catch (err) {
        if (!SHIPPED.has(pkg)) throw err;
        try {
          return of(shipped());
        } catch {
          throw err;
        }
      }
    };
    return { resolveRule: (pkg, name) => ask('rule', pkg, name), resolveConfig: (pkg, name) => ask('config', pkg, name) };
  }
}

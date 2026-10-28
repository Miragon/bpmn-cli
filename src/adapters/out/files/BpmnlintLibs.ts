import { createRequire } from 'node:module';
import type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinterClass, BpmnlintResolver } from '../bpmnlint/bpmnlint-contract.js';
import type { IdNamingHelpers } from '../bpmnlint/IdConventionsReader.js';
import { engineUnavailable, lazy, PLUGIN, SHIPPED, versionOf, type LoadFailure, type Require } from './utils/bpmnlint.js';
import { firstLine } from '../../../domain/document/utils/text.js';

/** What bpmn-cli uses of @miragon/bpmnlint-plugin-rules (a typed subset of its exports). */
export interface BpmnlintPlugin {
  createBundledResolver(): BpmnlintResolver;
  /** a host's default without a .bpmnlintrc: recommended rules, a preset and the engine's config */
  getDefaultLintConfig(options?: { engine?: 'c7' | 'c8'; preset?: 'modeling' | 'automation' }): BpmnlintConfig;
  naming: IdNamingHelpers;
}

type NodeResolverClass = new (options: { require: Require }) => BpmnlintResolver;

/**
 * bpmnlint and the Miragon plugin, required once per process. Linter and NodeResolver come
 * from the plugin's own location, so rules and linter are one bpmnlint even when hoisted.
 */
export class BpmnlintLibs {
  private static loaded: BpmnlintLibs | LoadFailure | undefined;

  private constructor(
    readonly Linter: BpmnlintLinterClass,
    private readonly NodeResolver: NodeResolverClass,
    readonly plugin: BpmnlintPlugin & { bundledResolverEntries: Record<string, unknown> },
    private readonly pluginRequire: Require,
    readonly bpmnlint: { version: string; dir: string },
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

  static engine(): BpmnlintEngine & { plugin: BpmnlintPlugin; bpmnlintVersion: string } {
    const libs = BpmnlintLibs.load();
    if (!(libs instanceof BpmnlintLibs)) {
      const unavailable = engineUnavailable(libs);
      throw new Error(`${unavailable.reason} (${unavailable.hint})`);
    }
    return { Linter: libs.Linter, resolver: libs.offlineResolver(), plugin: libs.plugin, bpmnlintVersion: libs.bpmnlint.version };
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

  private offlineResolver(): BpmnlintResolver {
    const bundled = this.bundledResolver();
    const shipped = lazy(() => this.shippedResolver());
    const ask = (kind: 'rule' | 'config', pkg: string, name: string): unknown => {
      const of = (resolver: BpmnlintResolver) => (kind === 'rule' ? resolver.resolveRule(pkg, name) : resolver.resolveConfig(pkg, name));
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

import Module from 'node:module';
import type { LoadedBpmnlint } from './BpmnlintLoader.js';
import { depState, isBare, packageOf, type LoadDeps } from './utils/dependencies.js';

interface CacheEntry {
  text: string;
  loaded: Promise<LoadedBpmnlint>;
  deps?: LoadDeps;
}

/**
 * Caches .bpmnlintrc loads per process, keyed on the file's text and on the state of what the
 * load depended on in the project. Plugin modules that did load stay in Node's require cache,
 * so a long-running host must restart after changing one.
 */
export class LoadCache {
  static readonly shared = new LoadCache();
  private readonly entries = new Map<string, CacheEntry>();

  loaded(key: string, text: string, dir: string, load: () => Promise<{ loaded: LoadedBpmnlint; deps: LoadDeps }>): Promise<LoadedBpmnlint> {
    const hit = this.entries.get(key);
    if (hit && hit.text === text && (!hit.deps || hit.deps.every((d) => depState(dir, d.ids) === d.state))) return hit.loaded;
    if (hit?.deps) this.forgetResolutions(hit.deps);
    const entry: CacheEntry = {
      text,
      loaded: load().then(({ loaded, deps }) => {
        if (deps.length) entry.deps = deps;
        return loaded;
      }),
    };
    this.entries.set(key, entry);
    entry.loaded.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.loaded;
  }

  /**
   * Module._pathCache keeps resolutions for the life of the process without touching the disk;
   * dropping them lets a reload find a package installed after one above the repository was found.
   */
  private forgetResolutions(deps: LoadDeps): void {
    const paths = (Module as unknown as { _pathCache?: Record<string, string> })._pathCache;
    if (!paths || typeof paths !== 'object') return;
    const requests = new Set<string>();
    const packages: string[] = [];
    for (const id of deps.flatMap((d) => d.ids)) {
      if (isBare(id)) packages.push(`${packageOf(id).name}/`);
      requests.add(isBare(id) ? packageOf(id).name : id);
    }
    for (const key of Object.keys(paths)) {
      const end = key.indexOf('\x00');
      const request = end < 0 ? key : key.slice(0, end);
      if (requests.has(request) || packages.some((p) => request.startsWith(p))) delete paths[key];
    }
  }
}

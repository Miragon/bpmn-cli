import Module from 'node:module';
import type { LoadedBpmnlint } from './BpmnlintLoader.js';
import { depState, isBare, packageOf, type LoadDeps } from './utils/dependencies.js';

interface CacheEntry {
  text: string;
  loaded: Promise<LoadedBpmnlint>;
  /** absent: the load depended on nothing outside the .bpmnlintrc, a hit checks nothing */
  deps?: LoadDeps;
}

/**
 * The loads of .bpmnlintrc files, for the life of the process: cached on the
 * file's text and on what it depended on in the project besides it
 * (LoadDeps): the packages it left out (a plugin installed after the hint),
 * the modules that failed to load and the moddle descriptors it read or could
 * not find, each as it was before the load looked it up (depState: where Node
 * resolves it, the nearest node_modules/<package> on disk, and the files'
 * path, inode, size, mtime, ctime). A cache hit with nothing left out and no
 * descriptor of the project checks nothing; one with some checks those and
 * loads again when one changed, after dropping Node's remembered resolutions
 * of them (a package found above the repository stays found there for the
 * life of the process otherwise). Project plugin modules that did load stay
 * in Node's require cache, and so does the package.json Node read: a
 * long-running host restarts after changing a plugin that loaded, or after a
 * reinstall that moved a package's entry module.
 */
export class LoadCache {
  static readonly shared = new LoadCache();
  private readonly entries = new Map<string, CacheEntry>();

  loaded(key: string, text: string, dir: string, load: () => Promise<{ loaded: LoadedBpmnlint; deps: LoadDeps }>): Promise<LoadedBpmnlint> {
    const hit = this.entries.get(key);
    // nothing left out and no descriptor of the project (deps absent): no stat, no resolve
    if (hit && hit.text === text && (!hit.deps || hit.deps.every((d) => depState(dir, d.ids) === d.state))) return hit.loaded;
    // loaded again: Node would still answer with where it found these before
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
   * Drops what Node remembers about resolving `deps` (Module._pathCache: a
   * request and its lookup paths -> the file, kept for the life of the process
   * and returned without looking at the disk), so a load again finds a package
   * installed inside the repository after one above it was found, and a
   * descriptor that moved. A package's own package.json Node keeps all the same
   * (a reinstall that moves its entry module needs a restart).
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

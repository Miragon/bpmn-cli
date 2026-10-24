import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * One thing a load depended on in the project besides the .bpmnlintrc's text
 * (LoadDeps): a package it left out, a module of the project that failed to
 * load, a moddle descriptor it read from the project or could not find, as
 * the spellings Node resolves from the .bpmnlintrc's directory (a module id,
 * a relative or absolute path); `state`: its depState before the load looked
 * it up (a change during the load is a change the next call sees).
 */
export interface Dep {
  ids: string[];
  state: string;
}

/** What a load depended on in the project (Dep); empty: nothing, a hit checks nothing. */
export type LoadDeps = Dep[];

/** A file's identity and version: path, inode, size, mtime, ctime (npm extracts with a fixed mtime: the inode and ctime count); `-` where it does not stat. */
function fileState(path: string): string {
  try {
    const st = statSync(path);
    return `${path}|${st.ino}|${st.size}|${st.mtimeMs}|${st.ctimeMs}`;
  } catch {
    return `${path}|-`;
  }
}

/** A module id that names a package (`pkg`, `@scope/pkg/sub/path`), not a relative or absolute path. */
export function isBare(id: string): boolean {
  return !isAbsolute(id) && !/^\.\.?(?:[/\\]|$)/.test(id);
}

/** The package of a bare module id (`@scope/pkg` of `@scope/pkg/resources/x`) and the path inside it. */
export function packageOf(id: string): { name: string; sub: string } {
  const parts = id.split('/');
  const n = id.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, n).join('/'), sub: parts.slice(n).join('/') };
}

/** The files that tell whether `id` changed on disk, looked up without Node's caches: the nearest node_modules/<package> from `dir` up (where Node looks first), its package.json and the path inside it; a relative or absolute path itself. */
function onDisk(dir: string, id: string): string[] {
  if (!isBare(id)) return [resolve(dir, id)];
  const { name, sub } = packageOf(id);
  for (let d = dir; ; d = dirname(d)) {
    const pkg = join(d, 'node_modules', name);
    if (basename(d) !== 'node_modules' && exists(pkg)) return [pkg, join(pkg, 'package.json'), ...(sub ? [join(pkg, sub)] : [])];
    if (dirname(d) === d) return [];
  }
}

function exists(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/** The first of `ids` that `req` resolves (a module id or an absolute path), or undefined. */
export function resolveFirst(req: { resolve(id: string): string }, ids: readonly string[]): string | undefined {
  for (const id of ids) {
    try {
      return req.resolve(id);
    } catch {
      /* the next spelling */
    }
  }
  return undefined;
}

/**
 * The state of one dependency (Dep) now: where Node resolves its spellings
 * from `dir` (an absolute path is not resolved), and the files on disk that
 * Node's caches do not see: the nearest package directory, its package.json
 * and the spellings themselves (fileState). Node remembers a resolution for
 * the life of the process (a package above the repository stays found there
 * after an install inside it); the files on disk show the install.
 */
export function depState(dir: string, ids: readonly string[]): string {
  const node = ids.every((id) => isAbsolute(id)) ? undefined : resolveFirst(createRequire(join(dir, '__bpmn-cli__.js')), ids);
  const files = new Set(node === undefined ? [] : [node]);
  for (const id of ids) for (const file of onDisk(dir, id)) files.add(file);
  return [`node:${node ?? '-'}`, ...[...files].map(fileState)].join('\n');
}

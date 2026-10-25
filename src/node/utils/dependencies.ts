import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Something a .bpmnlintrc load depended on in the project, as the spellings Node resolves;
 * `state` is taken before the load, so a change during the load shows on the next call.
 */
export interface Dep {
  ids: string[];
  state: string;
}

export type LoadDeps = Dep[];

/** npm extracts with a fixed mtime, so the inode and ctime must count too. */
function fileState(path: string): string {
  try {
    const st = statSync(path);
    return `${path}|${st.ino}|${st.size}|${st.mtimeMs}|${st.ctimeMs}`;
  } catch {
    return `${path}|-`;
  }
}

export function isBare(id: string): boolean {
  return !isAbsolute(id) && !/^\.\.?(?:[/\\]|$)/.test(id);
}

export function packageOf(id: string): { name: string; sub: string } {
  const parts = id.split('/');
  const n = id.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, n).join('/'), sub: parts.slice(n).join('/') };
}

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
 * Node remembers a resolution for the life of the process, so the files on disk are part of
 * the state: they show an install inside the repository after a package above it was found.
 */
export function depState(dir: string, ids: readonly string[]): string {
  const node = ids.every((id) => isAbsolute(id)) ? undefined : resolveFirst(createRequire(join(dir, '__bpmn-cli__.js')), ids);
  const files = new Set(node === undefined ? [] : [node]);
  for (const id of ids) for (const file of onDisk(dir, id)) files.add(file);
  return [`node:${node ?? '-'}`, ...[...files].map(fileState)].join('\n');
}

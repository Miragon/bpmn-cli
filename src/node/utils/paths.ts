import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export function inside(path: string, root: string): boolean {
  const r = relative(root, path);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/** A path without symlinks, as Node resolves modules (the path itself when it does not exist). */
export function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * A path for messages: relative to `from` when given (also when one of them
 * is reached through a symlink). A physical path (Node's, the lookup's second
 * walk) that lies outside `from` either way, from a `from` reached through a
 * link: relative to where the link leads, as `..` resolves there.
 */
export function shown(path: string, from?: string): string {
  if (from === undefined) return path;
  let r: string;
  if (inside(path, from)) r = relative(from, path);
  else if (inside(real(path), real(from))) r = relative(real(from), real(path));
  else r = path === real(path) && from !== real(from) ? relative(real(from), path) : relative(from, path);
  return r === '' ? '.' : r;
}

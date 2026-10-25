import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export function inside(path: string, root: string): boolean {
  const r = relative(root, path);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

export function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * A path for messages, relative to `from`; a physical path outside a symlinked `from` is
 * shown relative to where the link leads, as `..` resolves there.
 */
export function shown(path: string, from?: string): string {
  if (from === undefined) return path;
  let r: string;
  if (inside(path, from)) r = relative(from, path);
  else if (inside(real(path), real(from))) r = relative(real(from), real(path));
  else r = path === real(path) && from !== real(from) ? relative(real(from), path) : relative(from, path);
  return r === '' ? '.' : r;
}

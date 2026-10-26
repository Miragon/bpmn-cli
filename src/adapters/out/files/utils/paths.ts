import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export function inside(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
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
  let relativePath: string;
  if (inside(path, from)) relativePath = relative(from, path);
  else if (inside(real(path), real(from))) relativePath = relative(real(from), real(path));
  else relativePath = path === real(path) && from !== real(from) ? relative(real(from), path) : relative(from, path);
  return relativePath === '' ? '.' : relativePath;
}

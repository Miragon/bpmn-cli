import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Runs the CLI from src/ with tsx in the repository root. */
export function cli(...args: string[]): { code: number; out: string; err: string } {
  const spawned = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: spawned.status ?? -1, out: spawned.stdout, err: spawned.stderr };
}

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORACLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(ORACLE_DIR, '..', '..');
export const WORK_DIR = join(REPO_ROOT, '.oracle');
export const MAIN_ROOT = join(WORK_DIR, 'main');
export const BUILD_STAMP = join(WORK_DIR, 'main-build.json');
export const PLANTED_DIR = join(WORK_DIR, 'planted');
export const RESULT_FILE = join(WORK_DIR, 'result.json');
export const CORPUS_DIR = join(REPO_ROOT, 'corpus');

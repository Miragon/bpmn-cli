/**
 * Validation profiles (`--profile`, MutationOptions.profile) and the
 * design-iq content repository they detect.
 *
 * A design-iq content repository is a directory with a bpmiq.yml that names
 * the folder its models live in (`models: <folder>`, legacy `processes:`);
 * every .bpmn file below that folder is a process whose id is its file stem,
 * every .dmn a decision. design-iq validates each of them on every save.
 *
 * Profile choices:
 *  - design: the design profile (platform/design.ts) runs; inside a content
 *    repository it also checks call and decision links against its models;
 *  - none:   no profile;
 *  - auto (default): the design profile runs when the file (the one being
 *    written) is a model of a content repository: a bpmiq.yml in its
 *    directory or above names a models folder that contains it. Any other
 *    file gets no profile, so plain BPMN files are edited step by step as
 *    before.
 *
 * Node-only (reads the file system); the rules themselves do not.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { usageError } from '../errors.js';
import { designValidator } from './design.js';
import type { NamedValidator } from '../validators.js';

export type ProfileChoice = 'auto' | 'design' | 'none';
export const PROFILE_CHOICES: readonly ProfileChoice[] = ['auto', 'design', 'none'];

export const CONTENT_CONFIG_FILE = 'bpmiq.yml';

export interface ContentRepo {
  /** the directory holding bpmiq.yml */
  root: string;
  /** the models folder (absolute) */
  models: string;
}

export interface ProfileInfo {
  profile: 'design' | 'none';
  /** what decided it */
  source: 'option' | 'content-repo' | 'none';
  /** one line for humans */
  detail: string;
  /** the content repository of the file, if it is one of its models */
  repo?: ContentRepo;
}

/** E_USAGE for a profile that is not one of PROFILE_CHOICES. */
export function assertProfile(choice: unknown): asserts choice is ProfileChoice | undefined {
  if (choice === undefined || (PROFILE_CHOICES as readonly unknown[]).includes(choice)) return;
  throw usageError(`Unknown profile "${String(choice)}": expected ${PROFILE_CHOICES.join(', ')}`, {
    hint: 'design mirrors the design-iq save gate; auto runs it for the models of a design-iq content repository (bpmiq.yml); none switches it off.',
  });
}

/** The models folder a bpmiq.yml names (`models:` wins over the legacy `processes:`), undefined when it names none or an unsafe one. */
export function modelsFolderOf(config: string): string | undefined {
  const keys: Record<string, string> = {};
  for (const line of config.split(/\r?\n/)) {
    const m = /^(models|processes)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2]!.replace(/\s+#.*$/, '').trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1).trim();
    keys[m[1]!] = value;
  }
  // like design-iq: `models` wins whenever it is there (an empty one makes the file no content config)
  const folder = 'models' in keys ? keys['models'] : keys['processes'];
  if (!folder) return undefined;
  const parts = folder.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (folder.startsWith('/') || parts.includes('..')) return undefined;
  return parts.length ? parts.join('/') : '.';
}

/** The content repository `file` is a model of (the nearest bpmiq.yml above it naming a models folder that contains it). */
export function findContentRepo(file: string): ContentRepo | undefined {
  const path = resolve(file);
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const config = join(dir, CONTENT_CONFIG_FILE);
    if (existsSync(config)) {
      let text: string;
      try {
        text = readFileSync(config, 'utf8');
      } catch {
        return undefined;
      }
      const folder = modelsFolderOf(text);
      if (folder === undefined) return undefined;
      const models = resolve(dir, folder);
      const rel = relative(models, path);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
      return { root: dir, models };
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** The process and decision ids of a content repository: the file stems of its .bpmn and .dmn models (dot folders and node_modules skipped). */
export function contentModelIds(repo: ContentRepo): { processIds: Set<string>; decisionIds: Set<string> } {
  const processIds = new Set<string>();
  const decisionIds = new Set<string>();
  const visit = (dir: string, depth: number): void => {
    if (depth > 32) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const path = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) visit(path, depth + 1);
      else if (name.endsWith('.bpmn')) processIds.add(name.slice(0, -'.bpmn'.length));
      else if (name.endsWith('.dmn')) decisionIds.add(name.slice(0, -'.dmn'.length));
    }
  };
  visit(repo.models, 0);
  return { processIds, decisionIds };
}

/** The profile for a choice and the file being written or checked (see the module header). */
export function resolveProfile(choice: ProfileChoice = 'auto', file?: string): ProfileInfo {
  assertProfile(choice);
  const repo = file ? findContentRepo(file) : undefined;
  const where = repo ? `${CONTENT_CONFIG_FILE} in ${repo.root}` : '';
  if (choice === 'none') return { profile: 'none', source: 'option', detail: '--profile none' };
  if (choice === 'design') return { profile: 'design', source: 'option', detail: repo ? `--profile design; links checked against the models of ${where}` : '--profile design', ...(repo ? { repo } : {}) };
  if (repo) return { profile: 'design', source: 'content-repo', detail: `${where}: a design-iq content repository`, repo };
  return { profile: 'none', source: 'none', detail: 'not a model of a design-iq content repository (no bpmiq.yml above the file)' };
}

/** The design validator of a resolved profile (none for profile none); the file being written counts as a process of its repository. */
export function profileValidators(info: ProfileInfo, file?: string): NamedValidator[] {
  if (info.profile !== 'design') return [];
  if (!info.repo) return [designValidator({ detail: info.detail })];
  const { processIds, decisionIds } = contentModelIds(info.repo);
  if (file && file.endsWith('.bpmn')) processIds.add(basename(file).slice(0, -'.bpmn'.length));
  return [designValidator({ detail: info.detail, processIds, decisionIds })];
}

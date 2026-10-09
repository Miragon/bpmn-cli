/**
 * The design-iq content repository of a file, read from disk (Node only;
 * the profile decision itself is browser-safe: src/platform/repo.ts).
 *
 *   findContentRepo(file)   -> { root, models } of the nearest bpmiq.yml above the
 *                              file whose models folder contains it, else undefined
 *   contentModelIds(repo)   -> the process / decision ids (file stems of the
 *                              .bpmn / .dmn models; dot folders and node_modules skipped)
 *   contentRepoOf(file)     -> both together: what MutationOptions.contentRepo takes
 *   resolveFileProfile(choice, file) -> the ProfileInfo for a file (`--profile`)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CONTENT_CONFIG_FILE, modelsFolderOf, resolveProfile, type ContentRepo, type ProfileChoice, type ProfileInfo } from '../platform/repo.js';

/** A content repository found on disk: bpmiq.yml's directory and its models folder (absolute). */
export interface ContentRepoOnDisk extends ContentRepo {
  root: string;
  models: string;
}

/** The content repository `file` is a model of (the nearest bpmiq.yml above it naming a models folder that contains it). */
export function findContentRepo(file: string): ContentRepoOnDisk | undefined {
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
export function contentModelIds(repo: { models: string }): { processIds: Set<string>; decisionIds: Set<string> } {
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

/** The content repository of `file` with its model ids (MutationOptions.contentRepo), undefined when the file is no model of one. */
export function contentRepoOf(file: string): ContentRepoOnDisk | undefined {
  const repo = findContentRepo(file);
  return repo ? { ...repo, ...contentModelIds(repo) } : undefined;
}

/** The validation profile for a choice and a file on disk (see src/platform/repo.ts). */
export function resolveFileProfile(choice: ProfileChoice = 'auto', file?: string): ProfileInfo {
  return resolveProfile(choice, choice !== 'none' && file ? findContentRepo(file) : undefined);
}

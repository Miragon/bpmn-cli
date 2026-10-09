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
 *  - auto (default): the design profile runs when the document is a model of
 *    a content repository (MutationOptions.contentRepo; for a file the node
 *    layer finds it: a bpmiq.yml in the file's directory or above names a
 *    models folder that contains it). Any other document gets no profile, so
 *    plain BPMN files are edited step by step as before.
 *
 * This module is browser-safe: it decides from the ContentRepo the caller
 * gives. Finding a file's repository on disk (the bpmiq.yml lookup and the
 * model ids) is the node layer's: src/node/repo.ts.
 */
import { usageError } from '../errors.js';
import { designValidator } from './design.js';
import type { NamedValidator } from '../validators.js';

export type ProfileChoice = 'auto' | 'design' | 'none';
export const PROFILE_CHOICES: readonly ProfileChoice[] = ['auto', 'design', 'none'];

export const CONTENT_CONFIG_FILE = 'bpmiq.yml';

/**
 * The design-iq content repository a document is a model of. The node layer
 * fills it from disk (src/node/repo.ts contentRepoOf); a host that has no
 * file system passes what it knows (at least the model ids for the link
 * checks).
 */
export interface ContentRepo {
  /** the directory holding bpmiq.yml (shown in results) */
  root?: string;
  /** the models folder */
  models?: string;
  /** the processes of the repository (file stems of its .bpmn models); a callActivity's calledElement must be one */
  processIds?: Iterable<string>;
  /** the decisions of the repository (file stems of its .dmn models); a business rule task's decision must be one */
  decisionIds?: Iterable<string>;
}

export interface ProfileInfo {
  profile: 'design' | 'none';
  /** what decided it */
  source: 'option' | 'content-repo' | 'none';
  /** one line for humans */
  detail: string;
  /** the content repository of the document, if it is one of its models */
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

/** The profile for a choice and the content repository of the document (see the module header). */
export function resolveProfile(choice: ProfileChoice = 'auto', repo?: ContentRepo): ProfileInfo {
  assertProfile(choice);
  const where = repo ? (repo.root !== undefined ? `${CONTENT_CONFIG_FILE} in ${repo.root}` : 'the content repository given by the host') : '';
  if (choice === 'none') return { profile: 'none', source: 'option', detail: '--profile none' };
  if (choice === 'design') return { profile: 'design', source: 'option', detail: repo ? `--profile design; links checked against the models of ${where}` : '--profile design', ...(repo ? { repo } : {}) };
  if (repo) return { profile: 'design', source: 'content-repo', detail: `${where}: a design-iq content repository`, repo };
  return { profile: 'none', source: 'none', detail: 'not a model of a design-iq content repository (no bpmiq.yml above the file)' };
}

/** The file stem of a .bpmn path or name (`a/b/Order.bpmn` -> `Order`), else undefined. */
function bpmnStem(file: string): string | undefined {
  const name = file.split(/[\\/]/).pop() ?? '';
  return name.endsWith('.bpmn') ? name.slice(0, -'.bpmn'.length) : undefined;
}

/** The design validator of a resolved profile (none for profile none); the file being written counts as a process of its repository. */
export function profileValidators(info: ProfileInfo, file?: string): NamedValidator[] {
  if (info.profile !== 'design') return [];
  const repo = info.repo;
  if (!repo) return [designValidator({ detail: info.detail })];
  const processIds = repo.processIds ? new Set(repo.processIds) : undefined;
  const stem = file ? bpmnStem(file) : undefined;
  if (processIds && stem) processIds.add(stem);
  return [designValidator({ detail: info.detail, ...(processIds ? { processIds } : {}), ...(repo.decisionIds ? { decisionIds: new Set(repo.decisionIds) } : {}) })];
}

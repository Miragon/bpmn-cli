/**
 * Platform validation profiles: engine-specific checks on top of the
 * structural validation and lint of src/validate/structural.ts.
 *
 *  - runProfile(doc, choice) detects the platform (platform/detect.ts; an
 *    explicit choice wins) and runs its rules: Camunda 7 (platform/profiles/c7.ts;
 *    a file that uses the operaton namespace is read the way Operaton reads
 *    it, `operaton: true`), Camunda 8 (platform/profiles/c8.ts); plain BPMN has no
 *    engine rules.
 *  - The rules of a platform are loaded on demand (loadProfile: one
 *    `import()` per platform, cached), so a host's bundler puts each rule
 *    set into a chunk of its own that a plain or design model never
 *    fetches. runProfile stays synchronous and throws E_PROFILE_NOT_LOADED
 *    when the rules of the platform it resolves are not loaded; the async
 *    pipeline (mutateDoc, checkDoc and the in-memory API) loads them first
 *    (ensureProfile), a direct caller awaits loadProfile / loadProfiles. A
 *    chunk that fails to load rejects with E_PROFILE_LOAD (category io).
 *    Only this module imports c7.ts / c8.ts (tools/iso/check.mjs fails when
 *    a rule module is in a browser bundle's initial chunks), and they import
 *    nothing of the core: it hands them RULE_KIT (platform/profiles/rule-kit.ts), so
 *    a host whose entry module awaits a call at top level does not wait for
 *    itself (Rollup / Vite would make a rule chunk import the entry chunk).
 *  - `bpmn validate` reports every finding as a warning (`--strict` exits 5)
 *    and the platform it checked against (`--platform` overrides).
 *  - Mutations report only the findings the change introduced (profileDelta,
 *    like layout.metrics added/resolved), so a file's old problems are not
 *    repeated on every write; `validation.platform` carries the platform,
 *    the added and resolved findings and how many there are in total.
 *
 * Findings are matched by code, element (by identity, so a renamed element
 * keeps its findings) and subject (e.g. the attribute name).
 */
import type { Doc } from '../../model/document.js';
import { CliError } from '../../shared/CliError.js';
import { ioError, usageError } from '../../shared/utils/errors.js';
import type { El } from '../../model/utils/moddle.js';
import { resolvePlatform, type Platform, type PlatformChoice, type PlatformInfo } from '../detect.js';
import { SEVERITIES, subjectOf, type ProfileFinding, type Severity } from '../finding.js';
import { RULE_KIT } from './rule-kit.js';

export type { Platform, PlatformChoice, PlatformInfo } from '../detect.js';
export { PLATFORM_CHOICES } from '../detect.js';
export type { ProfileFinding, Severity } from '../finding.js';

export interface ProfileReport extends PlatformInfo {
  findings: ProfileFinding[];
}

/** What a result says about the profile (`validation.platform`). */
export interface PlatformSummary extends PlatformInfo {
  /** findings by severity (all of them, also the ones a mutation did not introduce) */
  counts: Record<Severity, number>;
  /** mutations: the findings the change introduced (also listed in validation.warnings) */
  added?: ProfileFinding[];
  /** mutations: findings the change removed */
  resolved?: ProfileFinding[];
}

/** A platform with engine rules. */
type EnginePlatform = Exclude<Platform, 'none'>;
type Rules = (doc: Doc, opts: { operaton: boolean }) => ProfileFinding[];

const ENGINE_NAMES: Record<EnginePlatform, string> = { c7: 'Camunda 7', c8: 'Camunda 8' };

/**
 * The engine rules of each platform, loaded the first time a document of
 * that platform is validated: a bundler makes each `import()` a chunk of its
 * own (an IIFE bundle inlines it). The rules get what they use of the core
 * from here (RULE_KIT, platform/profiles/rule-kit.ts) instead of importing it, so
 * their chunk imports nothing, also not the host's entry chunk.
 */
const LOADERS: Record<EnginePlatform, () => Promise<Rules>> = {
  c7: async () => {
    const { c7Findings, useKit } = await import('./c7.js');
    useKit(RULE_KIT);
    return (doc, opts) => c7Findings(doc, opts);
  },
  c8: async () => {
    const { c8Findings, useKit } = await import('./c8.js');
    useKit(RULE_KIT);
    return (doc) => c8Findings(doc);
  },
};

/** the rules loaded so far */
const RULES: Partial<Record<EnginePlatform, Rules>> = {};
/**
 * one load per platform; a failed one is forgotten, so a later call imports
 * the chunk again (in Node that loads it; a browser may keep the failed
 * module fetch for the same URL until the page reloads, Chrome does, and
 * the specifier is a static string a bundler rewrites, so it cannot vary)
 */
const LOADING: Partial<Record<EnginePlatform, Promise<void>>> = {};

function isEnginePlatform(platform: string): platform is EnginePlatform {
  return Object.hasOwn(LOADERS, platform);
}

/**
 * Loads the engine rules of `platform` (cached; `'none'` resolves at once).
 * The async API loads them itself; call it before the synchronous building
 * blocks (runProfile, validateDoc(doc, { platform })), or to prefetch the
 * chunk when a host opens a Camunda 7 / 8 file. Rejects with E_PROFILE_LOAD
 * (category io) when the module cannot be loaded; the failure is not
 * cached here (see LOADING).
 */
export function loadProfile(platform: Platform): Promise<void> {
  if (platform === 'none') return Promise.resolve();
  if (!isEnginePlatform(platform)) return Promise.reject(usageError(`Unknown platform "${String(platform)}": loadProfile takes 'c7', 'c8' or 'none'`, { hint: 'Pass the platform of a document (detectPlatform(doc).platform) or one of c7, c8.' }));
  const loaded = LOADING[platform];
  if (loaded) return loaded;
  const load = LOADERS[platform]().then(
    (rules) => {
      RULES[platform] = rules;
    },
    (err: unknown) => {
      delete LOADING[platform];
      throw ioError('E_PROFILE_LOAD', `The ${ENGINE_NAMES[platform]} profile rules could not be loaded: ${err instanceof Error ? err.message : String(err)}`, {
        platform,
        hint: 'They are a chunk of their own in a browser bundle: check that it is served next to the entry chunk (base URL, network, content security policy); nothing was written. A later call imports the chunk again (in Node that loads it), but a browser may keep the failed fetch until the page reloads (Chrome does): reload the page there.',
      });
    },
  );
  LOADING[platform] = load;
  return load;
}

/** Loads the engine rules of several platforms (default: all), e.g. once before synchronous runProfile / validateDoc calls. */
export async function loadProfiles(platforms: readonly EnginePlatform[] = ['c7', 'c8']): Promise<void> {
  await Promise.all(platforms.map((p) => loadProfile(p)));
}

/** Loads the rules runProfile(doc, choice) needs (the pipeline, before every profile run). */
export async function ensureProfile(doc: Doc, choice: PlatformChoice = 'auto'): Promise<void> {
  if (RULES.c7 && RULES.c8) return;
  await loadProfile(resolvePlatform(doc, choice).platform);
}

/**
 * Runs the profile of the document's platform (or of `choice`). Throws
 * E_PROFILE_NOT_LOADED when that platform's rules are not loaded
 * (loadProfile; the async API loads them itself).
 */
export function runProfile(doc: Doc, choice: PlatformChoice = 'auto'): ProfileReport {
  const info = resolvePlatform(doc, choice);
  if (info.platform === 'none') return { ...info, findings: [] };
  const rules = RULES[info.platform];
  if (!rules) {
    throw new CliError('E_PROFILE_NOT_LOADED', `The ${ENGINE_NAMES[info.platform]} profile rules are not loaded (they load on demand)`, 'usage', {
      platform: info.platform,
      hint: `await loadProfile('${info.platform}') (or loadProfiles()) before runProfile / validateDoc(doc, { platform }); applyToXml, validateXml, mutateDoc and checkDoc load them themselves.`,
    });
  }
  return { ...info, findings: rules(doc, { operaton: info.operaton === true }) };
}

export function summarize(report: ProfileReport): PlatformSummary {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of report.findings) counts[f.severity]++;
  return { platform: report.platform, source: report.source, detail: report.detail, ...(report.operaton ? { operaton: true } : {}), counts };
}

/** A profile run before a change, with the elements its findings named (renames keep their identity). */
export interface ProfileBaseline {
  report: ProfileReport;
  elements: Array<El | undefined>;
}

export function profileBaseline(doc: Doc, choice: PlatformChoice = 'auto'): ProfileBaseline {
  const report = runProfile(doc, choice);
  return { report, elements: report.findings.map((f) => (f.element ? doc.get(f.element) : undefined)) };
}

function sameFinding(a: ProfileFinding, aEl: El | undefined, b: ProfileFinding, bEl: El | undefined): boolean {
  if (a.code !== b.code || subjectOf(a) !== subjectOf(b)) return false;
  if (aEl && bEl) return aEl === bEl;
  return a.element === b.element;
}

/**
 * The findings `after` has that `before` did not (added) and the other way
 * round (resolved); each finding is matched at most once.
 */
export function profileDelta(doc: Doc, before: ProfileBaseline, after: ProfileReport): { added: ProfileFinding[]; resolved: ProfileFinding[] } {
  const left = before.report.findings.map((f, i) => ({ f, el: before.elements[i] }));
  const added: ProfileFinding[] = [];
  for (const f of after.findings) {
    const el = f.element ? doc.get(f.element) : undefined;
    const i = left.findIndex((b) => sameFinding(b.f, b.el, f, el));
    if (i === -1) added.push(f);
    else left.splice(i, 1);
  }
  return { added, resolved: left.map((b) => b.f) };
}

/**
 * Platform validation profiles: engine-specific checks on top of the
 * structural validation and lint of src/validate.ts.
 *
 *  - runProfile(doc, choice) detects the platform (platform/detect.ts; an
 *    explicit choice wins) and runs its rules: Camunda 7 (platform/c7.ts;
 *    a file that uses the operaton namespace is read the way Operaton reads
 *    it, `operaton: true`), Camunda 8 (platform/c8.ts); plain BPMN has no
 *    engine rules.
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
import type { Doc } from '../document.js';
import type { El } from '../model.js';
import { c7Findings } from './c7.js';
import { c8Findings } from './c8.js';
import { resolvePlatform, type Platform, type PlatformChoice, type PlatformInfo } from './detect.js';
import { SEVERITIES, subjectOf, type ProfileFinding, type Severity } from './finding.js';

export type { Platform, PlatformChoice, PlatformInfo } from './detect.js';
export { PLATFORM_CHOICES } from './detect.js';
export type { ProfileFinding, Severity } from './finding.js';

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

/** Runs the profile of the document's platform (or of `choice`). */
export function runProfile(doc: Doc, choice: PlatformChoice = 'auto'): ProfileReport {
  const info = resolvePlatform(doc, choice);
  const findings = info.platform === 'c7' ? c7Findings(doc, { operaton: info.operaton === true }) : info.platform === 'c8' ? c8Findings(doc) : [];
  return { ...info, findings };
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

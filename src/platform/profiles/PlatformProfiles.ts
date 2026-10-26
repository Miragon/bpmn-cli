import type { Doc } from '../../model/Doc.js';
import { CliError } from '../../shared/CliError.js';
import { ioError, usageError } from '../../shared/utils/errors.js';
import type { El } from '../../model/utils/moddle.js';
import { PlatformDetection, type Platform, type PlatformChoice, type PlatformInfo } from '../PlatformDetection.js';
import { SEVERITIES, subjectOf, type ProfileFinding, type Severity } from '../utils/finding.js';
import type { EngineProfile } from './EngineProfile.js';
import { RULE_KIT } from './rule-kit.js';

export interface ProfileReport extends PlatformInfo {
  findings: ProfileFinding[];
}

export interface PlatformSummary extends PlatformInfo {
  /** all findings, also the ones a mutation did not introduce */
  counts: Record<Severity, number>;
  added?: ProfileFinding[];
  resolved?: ProfileFinding[];
}

/** Keeps the elements themselves, so a renamed element keeps its findings. */
export interface ProfileBaseline {
  report: ProfileReport;
  elements: Array<El | undefined>;
}

type EnginePlatform = Exclude<Platform, 'none'>;

const ENGINE_NAMES: Record<EnginePlatform, string> = { c7: 'Camunda 7', c8: 'Camunda 8' };

/** The rules get RULE_KIT instead of importing the core, so their chunk imports nothing. */
const LOADERS: Record<EnginePlatform, () => Promise<EngineProfile>> = {
  c7: async () => {
    const { C7Profile } = await import('./C7Profile.js');
    return new C7Profile(RULE_KIT);
  },
  c8: async () => {
    const { C8Profile } = await import('./C8Profile.js');
    return new C8Profile(RULE_KIT);
  },
};

/**
 * Engine-specific checks on top of the structural validation. Each platform's rules load on
 * demand as a chunk of their own; run stays synchronous and throws E_PROFILE_NOT_LOADED until
 * they are loaded. Mutations report only the findings the change introduced (delta).
 */
export class PlatformProfiles {
  private readonly rules: Partial<Record<EnginePlatform, EngineProfile>> = {};
  /**
   * A failed load is forgotten, so a later call imports the chunk again; a browser
   * may keep the failed fetch until the page reloads, and the specifier cannot vary.
   */
  private readonly loading: Partial<Record<EnginePlatform, Promise<void>>> = {};

  load(platform: Platform): Promise<void> {
    if (platform === 'none') return Promise.resolve();
    if (!this.isEnginePlatform(platform)) return Promise.reject(usageError(`Unknown platform "${String(platform)}": loadProfile takes 'c7', 'c8' or 'none'`, { hint: 'Pass the platform of a document (detectPlatform(doc).platform) or one of c7, c8.' }));
    const loaded = this.loading[platform];
    if (loaded) return loaded;
    const load = LOADERS[platform]().then(
      (rules) => {
        this.rules[platform] = rules;
      },
      (err: unknown) => {
        delete this.loading[platform];
        throw ioError('E_PROFILE_LOAD', `The ${ENGINE_NAMES[platform]} profile rules could not be loaded: ${err instanceof Error ? err.message : String(err)}`, {
          platform,
          hint: 'They are a chunk of their own in a browser bundle: check that it is served next to the entry chunk (base URL, network, content security policy); nothing was written. A later call imports the chunk again (in Node that loads it), but a browser may keep the failed fetch until the page reloads (Chrome does): reload the page there.',
        });
      },
    );
    this.loading[platform] = load;
    return load;
  }

  async loadAll(platforms: readonly EnginePlatform[] = ['c7', 'c8']): Promise<void> {
    await Promise.all(platforms.map((platform) => this.load(platform)));
  }

  async ensure(doc: Doc, choice: PlatformChoice = 'auto'): Promise<void> {
    if (this.rules.c7 && this.rules.c8) return;
    await this.load(PlatformDetection.of(doc).resolve(choice).platform);
  }

  run(doc: Doc, choice: PlatformChoice = 'auto'): ProfileReport {
    const info = PlatformDetection.of(doc).resolve(choice);
    if (info.platform === 'none') return { ...info, findings: [] };
    const rules = this.rules[info.platform];
    if (!rules) {
      throw new CliError('E_PROFILE_NOT_LOADED', `The ${ENGINE_NAMES[info.platform]} profile rules are not loaded (they load on demand)`, 'usage', {
        platform: info.platform,
        hint: `await loadProfile('${info.platform}') (or loadProfiles()) before runProfile / validateDoc(doc, { platform }); applyToXml, validateXml, mutateDoc and checkDoc load them themselves.`,
      });
    }
    return { ...info, findings: rules.findings(doc, { operaton: info.operaton === true }) };
  }

  summarize(report: ProfileReport): PlatformSummary {
    const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
    for (const finding of report.findings) counts[finding.severity]++;
    return { platform: report.platform, source: report.source, detail: report.detail, ...(report.operaton ? { operaton: true } : {}), counts };
  }

  baseline(doc: Doc, choice: PlatformChoice = 'auto'): ProfileBaseline {
    const report = this.run(doc, choice);
    return { report, elements: report.findings.map((finding) => (finding.element ? doc.get(finding.element) : undefined)) };
  }

  /** Each finding is matched at most once, by code, element identity and subject. */
  delta(doc: Doc, before: ProfileBaseline, after: ProfileReport): { added: ProfileFinding[]; resolved: ProfileFinding[] } {
    const left = before.report.findings.map((finding, index) => ({ finding, el: before.elements[index] }));
    const added: ProfileFinding[] = [];
    for (const finding of after.findings) {
      const el = finding.element ? doc.get(finding.element) : undefined;
      const matchIndex = left.findIndex((candidate) => this.sameFinding(candidate.finding, candidate.el, finding, el));
      if (matchIndex === -1) added.push(finding);
      else left.splice(matchIndex, 1);
    }
    return { added, resolved: left.map((remaining) => remaining.finding) };
  }

  private isEnginePlatform(platform: string): platform is EnginePlatform {
    return Object.hasOwn(LOADERS, platform);
  }

  private sameFinding(first: ProfileFinding, aEl: El | undefined, second: ProfileFinding, bEl: El | undefined): boolean {
    if (first.code !== second.code || subjectOf(first) !== subjectOf(second)) return false;
    if (aEl && bEl) return aEl === bEl;
    return first.element === second.element;
  }
}

export const PLATFORM_PROFILES = new PlatformProfiles();

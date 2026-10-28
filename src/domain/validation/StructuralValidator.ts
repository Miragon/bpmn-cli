import type { Doc } from '../document/Doc.js';
import type { Finding } from '../document/Finding.js';
import { isEventSubProcess, isRejectedType } from '../document/Kinds.js';
import { completeMirrorLists } from '../document/utils/mirror.js';
import { is, walk, type El, shownId } from '../document/utils/moddle.js';
import type { ProfileFinding } from '../document/Finding.js';
import { PlatformCheck, type PlatformSummary, type ProfileReport } from './PlatformCheck.js';
import type { ValidatorReport } from './validators.js';
import { FlowOrder } from './FlowOrder.js';
import { lintCoveredBy } from './utils/finding-coverage.js';
import { EventChecks } from './structure/EventChecks.js';
import { FlowChecks } from './structure/FlowChecks.js';
import { LaneChecks } from './structure/LaneChecks.js';
import { ReferenceChecks } from './structure/ReferenceChecks.js';
import { ScopeLint } from './structure/ScopeLint.js';
import { StructureFindings } from './structure/StructureFindings.js';

export interface ValidationResult {
  errors: Finding[];
  warnings: Finding[];
  /** its findings are among the warnings */
  platform?: PlatformSummary;
  /** their findings are among the errors / warnings */
  validators?: ValidatorReport[];
}

/**
 * Structural validation (errors block writes) and lint (warnings); `withProfile` adds the
 * platform's engine-specific findings.
 */
export class StructuralValidator {
  constructor(private readonly doc: Doc) {}

  /** Completes the incoming/outgoing mirror lists first: the only change it makes to the model. */
  validate(): ValidationResult {
    return this.validateStructure();
  }

  /**
   * BPMN 2.0 makes the incoming/outgoing lists optional, but the placement grammar, view and
   * lint read them. In memory only: a write keeps the lists the way the file kept them.
   */
  repairFlowLinks(): number {
    return completeMirrorLists(this.doc.definitions);
  }

  /**
   * A lint warning a shown platform finding repeats is dropped (it adds the engine's verdict),
   * and so is a platform finding an E_INVALID_HOST already reports.
   */
  withProfile(result: ValidationResult, report: ProfileReport, shown: ProfileFinding[], delta?: { added: ProfileFinding[]; resolved: ProfileFinding[] }): ValidationResult {
    const invalidHost = new Set(
      [...result.errors, ...result.warnings]
        .filter((error) => error.code === 'E_INVALID_HOST' || (error.code === 'W_PREEXISTING_ERROR' && error.message.startsWith('E_INVALID_HOST')))
        .map((error) => error.element),
    );
    const repeated = (finding: ProfileFinding): boolean => (finding.code === 'W_C7_DEPLOY_BOUNDARY_HOST' || finding.code === 'W_C8_DEPLOY_BOUNDARY_HOST') && invalidHost.has(finding.element);
    if (invalidHost.size) {
      shown = shown.filter((finding) => !repeated(finding));
      report = { ...report, findings: report.findings.filter((finding) => !repeated(finding)) };
      if (delta) {
        delta = { added: delta.added.filter((finding) => !repeated(finding)), resolved: delta.resolved };
      }
    }
    const covered = lintCoveredBy(shown);
    const warnings = result.warnings.filter((warning) => !covered(warning));
    const platform: PlatformSummary = { ...PlatformCheck.summarize(report), ...(delta ? { added: delta.added, resolved: delta.resolved } : {}) };
    return { errors: result.errors, warnings: [...warnings, ...shown], platform };
  }

  private validateStructure(): ValidationResult {
    const { doc } = this;
    const findings = new StructureFindings();
    const references = new ReferenceChecks(doc, findings);
    const flows = new FlowChecks(doc, findings);
    const events = new EventChecks(doc, findings);
    const lanes = new LaneChecks(doc, findings);
    const lint = new ScopeLint(doc, findings);
    this.repairFlowLinks();
    references.checkDuplicateIds();
    references.checkReferences();
    references.checkRoots();
    for (const scope of this.scopes()) {
      for (const el of doc.flowElements(scope)) {
        const rejected = isRejectedType(el.$type);
        if (rejected) {
          findings.error('E_UNSUPPORTED_KIND', `${el.$type} ${shownId(el)} is not supported: ${rejected}`, shownId(el), {
            hint: `Remove it: \`bpmn remove <file> ${shownId(el)}\`.`,
          });
        }
        if (is(el, 'bpmn:SequenceFlow')) flows.checkSequenceFlow(el, scope);
        if (!is(el, 'bpmn:FlowNode')) continue;
        flows.checkFlowLinks(el);
        flows.checkDefaultFlow(el);
        if (is(el, 'bpmn:Event')) events.checkEvent(el, scope);
        if (is(el, 'bpmn:BoundaryEvent')) events.checkBoundaryEvent(el, scope);
        if (isEventSubProcess(el)) events.checkEventSubProcess(el);
      }
      if (is(scope, 'bpmn:Process')) lanes.checkLanes(scope);
      lint.lintScope(scope, new FlowOrder(doc, scope));
    }
    flows.checkMessageFlows();
    lint.checkDuplicateNames();
    return { errors: findings.errors, warnings: findings.warnings };
  }

  private scopes(): El[] {
    return [...walk(this.doc.definitions)].filter((el) => is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess'));
  }
}

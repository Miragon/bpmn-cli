import type { Doc } from '../../src/domain/document/Doc.js';
import type { PlatformChoice } from '../../src/domain/document/vendor/PlatformDetection.js';
import { PlatformCheck, type ProfileReport } from '../../src/domain/validation/PlatformCheck.js';
import { BpmnlintEngineLint } from '../../src/adapters/out/bpmnlint/BpmnlintEngineLint.js';
import { StructuralValidator, type ValidationResult } from '../../src/domain/validation/StructuralValidator.js';

const ENGINE = new BpmnlintEngineLint();

/** The engine findings of a document on their own, as checkDoc and every write compute them. */
export function runProfile(doc: Doc, choice?: PlatformChoice): Promise<ProfileReport> {
  return new PlatformCheck(ENGINE).run(doc, choice);
}

/** The structure, and with a `platform` the engine findings, of a document, as `bpmn validate` reports them without validators. */
export async function validateWithEngine(doc: Doc, opts: { platform?: PlatformChoice } = {}): Promise<ValidationResult> {
  const structure = new StructuralValidator(doc);
  if (opts.platform === undefined) return structure.validate();
  const report = await runProfile(doc, opts.platform);
  return structure.withProfile(structure.validate(), report, report.findings);
}

import { type BpmnDocument, type Finding, type Platform, type ProfileFinding } from '../model/index.js';
import { CamundaChecks } from './camunda/CamundaChecks.js';
import { StructureChecks } from './structure/StructureChecks.js';

export class ModelChecks {
  private static readonly BOUNDARY_HOST_CODES = ['W_C7_DEPLOY_BOUNDARY_HOST', 'W_C8_DEPLOY_BOUNDARY_HOST'];
  private static readonly START_CODES = ['W_C7_DEPLOY_START_EVENT', 'W_C7_TRANSACTION_NO_START', 'W_C8_DEPLOY_START_EVENT'];
  private static readonly START_WARNINGS = ['W_NO_START', 'W_EMPTY_SUBPROCESS'];

  constructor(
    private readonly document: BpmnDocument,
    private readonly platform?: Platform,
  ) {}

  private static branch({ element, related }: Finding): string {
    return `${element}|${related?.[0] ?? ''}`;
  }

  all(): Finding[] {
    const structure = new StructureChecks(this.document).all();
    const invalidHosts = new Set(structure.filter(({ code }) => code === 'E_INVALID_HOST').map(({ element }) => element));
    const camunda = new CamundaChecks(this.document, this.platform).all().filter(({ code, element }) => !ModelChecks.BOUNDARY_HOST_CODES.includes(code) || !invalidHosts.has(element));
    return [...ModelChecks.withoutRepeats(structure, camunda), ...camunda];
  }

  at(elements: Iterable<string>): Finding[] {
    const touched = new Set(elements);
    return this.all().filter(({ element }) => element !== undefined && touched.has(element));
  }

  private static withoutRepeats(structure: Finding[], camunda: ProfileFinding[]): Finding[] {
    const branches = new Set(camunda.filter(({ code }) => /^W_C[78]_.*EVENT_GATEWAY/.test(code)).map(ModelChecks.branch));
    const unstarted = new Set(camunda.filter(({ code, related }) => ModelChecks.START_CODES.includes(code) && !related?.length).map(({ element }) => element));
    return structure.filter((finding) => {
      const repeatsBranch = finding.code === 'W_EVENT_GATEWAY_TARGET' && branches.has(ModelChecks.branch(finding));
      return !repeatsBranch && !(ModelChecks.START_WARNINGS.includes(finding.code) && unstarted.has(finding.element));
    });
  }
}

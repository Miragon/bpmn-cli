import { type BpmnElement, Findings, type ProfileFinding, type Severity, type Suggestion } from '../../../model/index.js';
import { ElementAddress } from './ElementAddress.js';

export interface RuleReport {
  code: string;
  element: BpmnElement | undefined;
  owner?: BpmnElement | undefined;
  subject: string;
  message: string;
  hint: string;
  related?: string[];
  fix?: Suggestion;
}

export class RuleReporter {
  readonly findings: ProfileFinding[] = [];
  private currentHost: BpmnElement;
  private currentOwner: BpmnElement | undefined;
  private inExecutable = true;

  constructor(definitions: BpmnElement) {
    this.currentHost = definitions;
  }

  get host(): BpmnElement {
    return this.currentHost;
  }

  get owner(): BpmnElement | undefined {
    return this.currentOwner;
  }

  get executable(): boolean {
    return this.inExecutable;
  }

  enter(host: BpmnElement, owner: BpmnElement | undefined, executable: boolean): void {
    this.currentHost = host;
    this.currentOwner = owner;
    this.inExecutable = executable;
  }

  deploy(report: RuleReport): void {
    this.add('deploy', report);
  }

  runtime(report: RuleReport): void {
    this.add('runtime', report);
  }

  practice(report: RuleReport): void {
    this.add('practice', report);
  }

  private add(severity: Severity, { code, element, owner, subject, message, hint, related, fix }: RuleReport): void {
    const finding = Findings.make(severity, code, message, RuleReporter.targetOf(element, owner), { hint, related: related ?? [], subject });
    if (fix) {
      finding.fix = fix;
    }
    this.findings.push(finding);
  }

  private static targetOf(element: BpmnElement | undefined, owner: BpmnElement | undefined): string | undefined {
    const address = element && ElementAddress.of(element, owner);
    return address?.prefix ? address.id : element?.id || owner?.id;
  }
}

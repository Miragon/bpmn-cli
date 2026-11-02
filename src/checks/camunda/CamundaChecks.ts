import { type BpmnDocument, type BpmnElement, type Platform, PlatformDetection, type ProfileFinding } from '../../model/index.js';

export class CamundaChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly platform?: Platform,
  ) {}

  async all(): Promise<ProfileFinding[]> {
    const { platform, operaton } = new PlatformDetection(this.document.tree.definitions).info();
    const engine = this.platform ?? platform;
    if (engine === 'c7') {
      const { C7Checks } = await import('./c7/C7Checks.js');
      return new C7Checks(this.document, operaton === true).findings();
    }
    if (engine === 'c8') {
      const { C8Checks } = await import('./c8/C8Checks.js');
      return new C8Checks(this.document).findings();
    }
    return [];
  }

  async onExecutableProcesses(): Promise<ProfileFinding[]> {
    const executable = this.document.tree.processes().filter(CamundaChecks.isExecutable);
    if (!executable.length) {
      return [];
    }
    return (await this.all()).filter(({ element }) => !this.isInOtherProcess(element, executable));
  }

  private static isExecutable(process: BpmnElement): boolean {
    return process.peek<boolean>('isExecutable') === true;
  }

  private static processOf(element: BpmnElement | undefined): BpmnElement | undefined {
    let current = element;
    while (current && !current.is('bpmn:Process')) {
      current = current.parent;
    }
    return current;
  }

  private isInOtherProcess(id: string | undefined, executable: readonly BpmnElement[]): boolean {
    const process = CamundaChecks.processOf(id === undefined ? undefined : this.document.tree.byId(id));
    return process !== undefined && !executable.includes(process);
  }
}

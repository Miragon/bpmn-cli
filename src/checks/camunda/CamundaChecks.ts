import { type BpmnDocument, type Platform, PlatformDetection, type ProfileFinding } from '../../model/index.js';

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
}

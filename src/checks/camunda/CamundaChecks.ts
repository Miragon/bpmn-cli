import { type BpmnDocument, type Platform, PlatformDetection, type ProfileFinding } from '../../model/index.js';
import { C7Checks } from './c7/C7Checks.js';
import { C8Checks } from './c8/C8Checks.js';

export class CamundaChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly platform?: Platform,
  ) {}

  all(): ProfileFinding[] {
    const { platform, operaton } = new PlatformDetection(this.document.tree.definitions).info();
    const engine = this.platform ?? platform;
    if (engine === 'c7') {
      return new C7Checks(this.document, operaton === true).findings();
    }
    return engine === 'c8' ? new C8Checks(this.document).findings() : [];
  }
}

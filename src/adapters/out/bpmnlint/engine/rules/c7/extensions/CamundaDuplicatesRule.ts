import { ERROR_TYPES, type Reporter } from '../../CamundaRules.js';
import type { C7Host } from './C7Host.js';
import { C7ExtensionRule } from './C7HostRule.js';
import { CamundaDuplicates } from './CamundaDuplicates.js';
import type { ExtensionHints } from './ExtensionHints.js';

/** One camunda extension element a host has more than once. */
export interface DuplicatedExtension {
  host: C7Host;
  /** `inputOutput` */
  local: string;
  /** `camunda:inputOutput`, in the file's spelling */
  typeName: string;
  count: number;
}

/**
 * A Camunda 7 rule over the camunda extension elements an executable element has twice or more:
 * either those the engines read now, or those they read once the element runs asynchronously.
 */
export abstract class CamundaDuplicatesRule extends C7ExtensionRule {
  protected abstract readonly reportsRead: boolean;

  protected abstract messageOf(duplicated: DuplicatedExtension): string;

  protected checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    for (const { local, extensions, isRead } of new CamundaDuplicates(host).groups()) {
      const [, second] = extensions;
      if (isRead !== this.reportsRead || !second) {
        continue;
      }
      const typeName = hints.typeName(local);
      host.report(reporter, {
        message: this.messageOf({ host, local, typeName, count: extensions.length }),
        path: host.extensionPath(second.index),
        type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        node: second.value,
        hint: hints.merge(local),
      });
    }
  }
}

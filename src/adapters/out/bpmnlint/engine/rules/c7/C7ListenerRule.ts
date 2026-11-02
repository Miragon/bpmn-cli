import type { ReportPath } from '../CamundaRule.js';
import { C7ExtensionContentRule } from './C7ExtensionContentRule.js';
import type { C7Host, HostExtension } from './support/C7Host.js';

/** A camunda:executionListener or taskListener a listener rule checks, with how its messages name it. */
export interface Listener {
  host: C7Host;
  extension: HostExtension;
  event: string | undefined;
  /** `camunda:taskListener (event create) of userTask Review` */
  label: string;
}

/**
 * The base of the Camunda 7 rules on execution and task listeners: a rule implements
 * `checkListener(listener)` for each listener the engines read, and reports on it with
 * `reportListener`.
 * Camunda 7 parses the listeners when it deploys the file and refuses one it cannot run.
 *
 * @example a listener that runs nothing
 * <camunda:executionListener event="start" />  <!-- no class, expression or script -->
 */
export abstract class C7ListenerRule extends C7ExtensionContentRule {
  protected checkHost(host: C7Host, read: HostExtension[]): void {
    for (const extension of read) {
      const { value, local } = extension;
      if (local !== 'executionListener' && local !== 'taskListener') continue;
      const event: string | undefined = value.get('event');
      this.checkListener({ host, extension, event, label: `${host.typeName(local)}${event ? ` (event ${event})` : ''} of ${host.describe()}` });
    }
  }

  protected abstract checkListener(listener: Listener): void;

  protected reportListener({ host, extension }: Listener, message: string, steps: ReportPath, type: string, details: Record<string, unknown>): void {
    this.reportOn(host, message, { path: host.extensionPath(extension.index, ...steps), type, node: extension.value, ...details });
  }
}

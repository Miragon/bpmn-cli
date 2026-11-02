import { C7Rule, type ModdleElement, type ReportData } from '../CamundaRule.js';
import type { VendorHost } from '../support/VendorHost.js';
import { C7Host } from './support/C7Host.js';

/**
 * The base of the Camunda 7 rules on vendor content the engines do not read: a rule implements
 * `checkHost(host)` for each BPMN element the engines look at, and reports with `reportContent`.
 * Camunda 7 deploys the file and silently ignores such a setting, so the process runs without the
 * behaviour the model seems to configure.
 *
 * @example a typo in an attribute name
 * <bpmn:userTask id="Review" camunda:asignee="demo" />  <!-- nobody gets assigned -->
 */
export abstract class C7VendorContentRule extends C7Rule {
  protected visit(node: ModdleElement): boolean | void {
    if (!C7Host.visits(node)) return false;
    this.checkHost(new C7Host(node));
  }

  protected abstract checkHost(host: C7Host): void;

  protected reportContent(host: VendorHost, message: string, { path, ...data }: ReportData): void {
    this.report(host.target, message, { node: host.node, path, ...data });
  }
}

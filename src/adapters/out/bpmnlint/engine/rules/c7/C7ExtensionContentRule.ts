import { C7Rule, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7Host, type HostExtension } from './support/C7Host.js';
import { CamundaPlacement } from './support/CamundaPlacement.js';

/**
 * The base of the Camunda 7 rules on the content of camunda extension elements (listeners,
 * input/output mappings, fields, forms, connectors): a rule implements `checkHost(host, read)` for
 * each element of an executable process, with the extension elements the engines read there.
 * Camunda 7 parses that content when it deploys the file and refuses it where a required part is
 * missing, a value unknown or the placement forbidden.
 *
 * @example a listener that runs nothing
 * <camunda:executionListener event="start" />  <!-- no class, expression or script -->
 */
export abstract class C7ExtensionContentRule extends C7Rule {
  protected visit(node: ModdleElement): boolean | void {
    if (!C7Host.visits(node)) return false;
    if (!EngineScope.inExecutableProcess(node)) return;
    const host = new C7Host(node);
    this.checkHost(host, new CamundaPlacement(host).readExtensions());
  }

  protected abstract checkHost(host: C7Host, read: HostExtension[]): void;
}

import { C7Rule, type ModdleElement, type Reporter } from '../../CamundaRules.js';
import { C7Host } from './C7Host.js';
import { ExtensionHints } from './ExtensionHints.js';

/** A Camunda 7 rule over the elements the checks visit (`C7Host.visits`), each one as its host. */
export abstract class C7HostRule extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): boolean | void {
    if (!C7Host.visits(node)) {
      return false;
    }
    this.checkHost(new C7Host(node), reporter);
  }

  protected abstract checkHost(host: C7Host, reporter: Reporter): void;
}

/**
 * A Camunda 7 rule over the camunda extension content of the visited elements below
 * `bpmn:Definitions`; by default only of the elements of an executable process.
 */
export abstract class C7ExtensionRule extends C7HostRule {
  protected readonly executableOnly: boolean = true;

  protected checkHost(host: C7Host, reporter: Reporter): void {
    if (host.isDefinitions() || (this.executableOnly && !C7Host.isExecutable(host.node))) {
      return;
    }
    this.checkExtensions(host, new ExtensionHints(host), reporter);
  }

  protected abstract checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void;
}

import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C7_URIS, DiagramNamespaces } from '../support/DiagramNamespaces.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host } from './support/C8Host.js';
import type { ZeebeHint } from './support/ZeebeHint.js';

/** The zeebe content Camunda 8 reads in place of a Camunda 7 attribute or element, as `bpmn ext add` takes it. */
const CAMUNDA_8_EQUIVALENT: Record<string, string> = {
  assignee: 'assignmentDefinition assignee=<assignee>',
  candidateGroups: 'assignmentDefinition candidateGroups=<groups>',
  candidateUsers: 'assignmentDefinition candidateUsers=<users>',
  dueDate: 'taskSchedule dueDate=<date>',
  followUpDate: 'taskSchedule followUpDate=<date>',
  priority: 'priorityDefinition priority=<0..100>',
  formKey: 'formDefinition formId=<formId>',
  topic: 'taskDefinition type=<jobType>',
  type: 'taskDefinition type=<jobType>',
  class: 'taskDefinition type=<jobType>',
  delegateExpression: 'taskDefinition type=<jobType>',
  expression: 'taskDefinition type=<jobType>',
  decisionRef: 'calledDecision decisionId=<decisionId> resultVariable=<variable>',
  inputOutput: 'input source==<expression> target=<variable>',
  versionTag: 'versionTag value=<tag>',
};

/**
 * Camunda 7 content in a Camunda 8 model: camunda and operaton attributes and extension elements.
 * Camunda 8 deploys the file and silently ignores them, so the process runs without the behaviour
 * the model seems to configure.
 *
 * @example a Camunda 7 assignee in a Camunda 8 model
 * <bpmn:userTask id="Review" camunda:assignee="demo" />  <!-- Camunda 8 reads zeebe:assignmentDefinition -->
 */
class C8NoCamunda7ContentRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    const hint = host.hint();
    for (const { key, uri } of host.foreignAttributes()) {
      if (C7_URIS.includes(uri ?? '')) {
        this.reportContent(host, `${host.describe()} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: key, path: host.path(key), hint: this.removeHint(hint, key, hint ? hint.unset(key) : 'edit the XML') });
      }
    }
    const namespaces = DiagramNamespaces.forElement(host.node);
    host.extensionValues().forEach((value, index) => {
      const type = String(value.$type ?? '');
      if (value.$descriptor?.isGeneric && C7_URIS.includes(namespaces.uriOf(type) ?? '')) {
        this.reportContent(host, `${host.describe()} contains the Camunda 7 extension ${type}, which Camunda 8 ignores`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: value, path: host.extensionPath(index), hint: this.removeHint(hint, type, hint ? hint.extRemove(index) : 'remove it from the XML') });
      }
    });
  }

  /** `Remove it: <remove>`, and the zeebe content Camunda 8 reads instead, if there is one. */
  private removeHint(hint: ZeebeHint | undefined, name: string, remove: string): string {
    const equivalent = CAMUNDA_8_EQUIVALENT[name.slice(name.indexOf(':') + 1)];
    if (!equivalent) return `Remove it: ${remove}.`;
    return `Remove it: ${remove}; Camunda 8 reads ${hint ? hint.extAdd(hint.name(equivalent)) : 'edit the XML'}.`;
  }
}

export default defineRule({ ruleName: 'c8-no-camunda-7-content', code: 'W_C8_FOREIGN_CONTENT', impact: 'runtime' }, C8NoCamunda7ContentRule);

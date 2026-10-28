import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';


import type { El } from '../../../../domain/document/utils/moddle.js';


import type { DocumentNamespaces } from '../../../../domain/document/vendor/DocumentNamespaces.js';
import type { EngineKit } from '../engine-kit.js';

/**
 * `zeebe:publishMessage`, which Camunda 8.9 checks but does not run. zeebe-bpmn-moddle does not
 * define it, so a typed parse drops it: no bpmnlint rule sees it, and camunda-compat reports its
 * send task as one without an implementation. bpmn-cli's model keeps it; `hosts` are the elements
 * whose implementation findings it answers.
 */
export class PublishMessages {
  readonly hosts = new Set<string>();
  private readonly ns: DocumentNamespaces;
  private readonly prefix: string;

  constructor(private readonly kit: EngineKit, private readonly doc: Doc) {
    this.ns = new this.kit.DocumentNamespaces(doc);
    this.prefix = this.ns.prefixOf(this.kit.ZEEBE.uri) ?? 'zeebe';
  }

  findings(): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    for (const proc of this.doc.processes().filter((candidate) => this.kit.peek<boolean>(candidate, 'isExecutable') === true)) {
      for (const el of this.kit.walk(proc, { bpmnOnly: true })) {
        if (this.kit.is(el, 'bpmn:SendTask')) this.check(el, el, out);
        else if (this.kit.is(el, 'bpmn:IntermediateThrowEvent') || this.kit.is(el, 'bpmn:EndEvent')) {
          const definition = this.kit.list(el, 'eventDefinitions').find((candidate) => this.kit.is(candidate, 'bpmn:MessageEventDefinition'));
          if (definition) this.check(el, definition, out);
        }
      }
    }
    return out;
  }

  private check(el: El, host: El, out: ProfileFinding[]): void {
    const publish = this.zeebe(host, 'publishMessage')[0];
    if (!publish) return;
    const id = this.kit.peek<string>(el, 'id')!;
    const label = `${this.kit.kindLabel(el).charAt(0).toLowerCase()}${this.kit.kindLabel(el).slice(1)} ${id}`;
    const name = `${this.prefix}:publishMessage`;
    const slot = host === el ? '' : 'definition.';
    this.hosts.add(id);
    if (this.zeebe(el, 'taskDefinition').length) {
      out.push(this.kit.makeFinding('deploy', 'W_C8_DEPLOY_IMPLEMENTATION', `${label} has both a ${this.prefix}:taskDefinition and a ${name}; Camunda 8 needs exactly one of them and refuses the file`, id, { subject: 'impl:both', hint: `Keep one: \`bpmn ext remove <file> ${id} ${this.prefix}:taskDefinition\` (or \`bpmn ext remove <file> ${id} ${slot}${name}\`).` }));
      return;
    }
    if (!this.kit.peek<El>(host, 'messageRef')) out.push(this.kit.makeFinding('deploy', 'W_C8_DEPLOY_MESSAGE', `${label} publishes no message (no message reference); Camunda 8 refuses the file`, id, { subject: 'publish:messageRef', hint: `\`bpmn set <file> ${id} message=<MessageName>\`.` }));
    const correlationKey = this.kit.peek<string>(publish, 'correlationKey');
    if (correlationKey === undefined || correlationKey === '') out.push(this.kit.makeFinding('deploy', 'W_C8_DEPLOY_MESSAGE', `The ${name} of ${label} has no correlationKey; Camunda 8 refuses the file`, id, { subject: 'publish:correlationKey', hint: `\`bpmn ext add <file> ${id} ${slot}${name} correlationKey==<expression>\`.` }));
    const send = this.kit.is(el, 'bpmn:SendTask');
    out.push(this.kit.makeFinding('runtime', 'W_C8_UNSUPPORTED_IMPLEMENTATION', `${label} publishes its message with ${name}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, id, { subject: 'publishMessage', hint: `Use a job worker: \`bpmn ext remove <file> ${id} ${slot}${name}\`, then \`bpmn ext add <file> ${id} ${this.prefix}:taskDefinition type=<jobType>\`.` }));
  }

  private zeebe(el: El, local: string): El[] {
    return this.kit.list(this.kit.peek<El>(el, 'extensionElements'), 'values').filter((value) => this.ns.uriOfElement(value) === this.kit.ZEEBE.uri && value.$type.slice(value.$type.indexOf(':') + 1) === local);
  }
}

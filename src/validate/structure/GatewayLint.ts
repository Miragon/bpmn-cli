import type { Doc } from '../../model/Doc.js';
import { ignoresConditions, kindOf } from '../../model/utils/kinds.js';
import { is, type El, peek, shownId } from '../../model/utils/moddle.js';
import type { StructureFindings } from './StructureFindings.js';

/** Gateway naming, conditions a gateway never evaluates, and what an event-based gateway leads to. */
export class GatewayLint {
  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  lint(node: El, outgoing: El[]): void {
    if (['exclusiveGateway', 'inclusiveGateway'].includes(kindOf(node)?.kind ?? '')) {
      if (this.isSplitGateway(node)) {
        const name = this.findings.nameOf(node);
        if (!name || !name.trim().endsWith('?')) {
          this.findings.warning('W_GATEWAY_NAME', `${this.findings.describe(node)} splits but is not named as a question`, shownId(node), {
            hint: `Name splitting gateways as a question, e.g. \`bpmn set <file> ${shownId(node)} name="Invoice ok?"\`.`,
          });
        }
        const unnamed = outgoing.filter((f) => !this.findings.nameOf(f));
        if (unnamed.length) {
          this.findings.warning('W_BRANCH_NAME', `Branches ${unnamed.map(shownId).join(', ')} of ${this.findings.describe(node)} have no name`, shownId(node), {
            related: unnamed.map(shownId),
            hint: 'Name each branch with its answer, e.g. `bpmn set <file> <flowId> name=yes`.',
          });
        }
      } else if (this.isJoinGateway(node) && this.findings.nameOf(node)) {
        this.findings.warning('W_NAMED_JOIN', `Joining gateway ${this.findings.describe(node)} should not have a name`, shownId(node), {
          hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
        });
      }
    }
    if (is(node, 'bpmn:ParallelGateway') && this.findings.nameOf(node)) {
      this.findings.warning('W_NAMED_PARALLEL', `Parallel gateway ${this.findings.describe(node)} should not have a name`, shownId(node), {
        hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
      });
    }
    if (ignoresConditions(node)) {
      const conditional = outgoing.filter((f) => peek<El | undefined>(f, 'conditionExpression'));
      if (conditional.length) {
        this.findings.warning('W_CONDITION_IGNORED', `Flows ${conditional.map(shownId).join(', ')} out of ${this.findings.describe(node)} have a condition, which the gateway never evaluates`, shownId(node), {
          related: conditional.map(shownId),
          hint: `Remove them (\`bpmn set <file> ${shownId(conditional[0])} condition=\`), or branch by condition: \`bpmn retype <file> ${shownId(node)} exclusiveGateway\`.`,
        });
      }
    }
    if (is(node, 'bpmn:EventBasedGateway')) {
      for (const f of outgoing) {
        const t = peek<El>(f, 'targetRef');
        if (t && !is(t, 'bpmn:IntermediateCatchEvent') && !is(t, 'bpmn:ReceiveTask')) {
          this.findings.warning('W_EVENT_GATEWAY_TARGET', `Event-based gateway ${shownId(node)} leads to ${this.findings.describe(t)}, which is not a catching event or receive task`, shownId(node), {
            related: [shownId(t)],
            hint: 'Every branch of an event-based gateway must start with an intermediateCatchEvent (message/timer/signal/conditional) or a receiveTask.',
          });
        }
      }
    }
  }

  private isSplitGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.outgoing(node).length >= 2;
  }

  private isJoinGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.incoming(node).length >= 2 && this.doc.outgoing(node).length <= 1;
  }
}

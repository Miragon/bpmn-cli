import type { Doc } from '../../document/Doc.js';
import { ignoresConditions, namedAsQuestion } from '../../document/utils/kinds.js';
import { is, type El, peek, shownId } from '../../document/utils/moddle.js';
import type { StructureFindings } from './StructureFindings.js';

/** Gateway naming, conditions a gateway never evaluates, and what an event-based gateway leads to. */
export class GatewayLint {
  constructor(
    private readonly doc: Doc,
    private readonly findings: StructureFindings,
  ) {}

  lint(node: El, outgoing: El[]): void {
    if (namedAsQuestion(node)) {
      if (this.isSplitGateway(node)) {
        this.lintQuestionName(node);
        this.lintBranchNames(node, outgoing);
      } else {
        this.lintJoinName(node);
      }
    }
    this.lintParallelName(node);
    this.lintIgnoredConditions(node, outgoing);
    this.lintEventGatewayTargets(node, outgoing);
  }

  private lintQuestionName(node: El): void {
    const name = this.findings.nameOf(node);
    if (name?.trim().endsWith('?')) return;
    this.findings.warning('W_GATEWAY_NAME', `${this.findings.describe(node)} splits but is not named as a question`, shownId(node), {
      hint: `Name splitting gateways as a question, e.g. \`bpmn set <file> ${shownId(node)} name="Invoice ok?"\`.`,
    });
  }

  private lintBranchNames(node: El, outgoing: El[]): void {
    const unnamed = outgoing.filter((flow) => !this.findings.nameOf(flow));
    if (!unnamed.length) return;
    this.findings.warning('W_BRANCH_NAME', `Branches ${unnamed.map(shownId).join(', ')} of ${this.findings.describe(node)} have no name`, shownId(node), {
      related: unnamed.map(shownId),
      hint: 'Name each branch with its answer, e.g. `bpmn set <file> <flowId> name=yes`.',
    });
  }

  private lintJoinName(node: El): void {
    if (!this.isJoinGateway(node) || !this.findings.nameOf(node)) return;
    this.findings.warning('W_NAMED_JOIN', `Joining gateway ${this.findings.describe(node)} should not have a name`, shownId(node), {
      hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
    });
  }

  private lintParallelName(node: El): void {
    if (!is(node, 'bpmn:ParallelGateway') || !this.findings.nameOf(node)) return;
    this.findings.warning('W_NAMED_PARALLEL', `Parallel gateway ${this.findings.describe(node)} should not have a name`, shownId(node), {
      hint: `Unset it: \`bpmn set <file> ${shownId(node)} name=\`.`,
    });
  }

  private lintIgnoredConditions(node: El, outgoing: El[]): void {
    if (!ignoresConditions(node)) return;
    const conditional = outgoing.filter((flow) => peek<El | undefined>(flow, 'conditionExpression'));
    if (!conditional.length) return;
    this.findings.warning('W_CONDITION_IGNORED', `Flows ${conditional.map(shownId).join(', ')} out of ${this.findings.describe(node)} have a condition, which the gateway never evaluates`, shownId(node), {
      related: conditional.map(shownId),
      hint: `Remove them (\`bpmn set <file> ${shownId(conditional[0])} condition=\`), or branch by condition: \`bpmn retype <file> ${shownId(node)} exclusiveGateway\`.`,
    });
  }

  private lintEventGatewayTargets(node: El, outgoing: El[]): void {
    if (!is(node, 'bpmn:EventBasedGateway')) return;
    const targets = outgoing.map((flow) => peek<El>(flow, 'targetRef')).filter((target): target is El => !!target);
    for (const target of targets.filter((candidate) => !is(candidate, 'bpmn:IntermediateCatchEvent') && !is(candidate, 'bpmn:ReceiveTask'))) {
      this.findings.warning('W_EVENT_GATEWAY_TARGET', `Event-based gateway ${shownId(node)} leads to ${this.findings.describe(target)}, which is not a catching event or receive task`, shownId(node), {
        related: [shownId(target)],
        hint: 'Every branch of an event-based gateway must start with an intermediateCatchEvent (message/timer/signal/conditional) or a receiveTask.',
      });
    }
  }

  private isSplitGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.outgoing(node).length >= 2;
  }

  private isJoinGateway(node: El): boolean {
    return is(node, 'bpmn:Gateway') && this.doc.incoming(node).length >= 2 && this.doc.outgoing(node).length <= 1;
  }
}

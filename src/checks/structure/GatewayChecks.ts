import { type BpmnDocument, type BpmnElement, ElementText, Kinds } from '../../model/index.js';
import type { StructureFindings } from './StructureFindings.js';

export class GatewayChecks {
  constructor(
    private readonly document: BpmnDocument,
    private readonly findings: StructureFindings,
  ) {}

  lint(node: BpmnElement, outgoing: BpmnElement[]): void {
    if (Kinds.namedAsQuestion(node)) {
      if (this.isSplitGateway(node)) {
        this.checkQuestionName(node);
        this.checkBranchNames(node, outgoing);
      } else {
        this.checkJoinName(node);
      }
    }
    this.checkParallelName(node);
    this.checkIgnoredConditions(node, outgoing);
    this.checkEventGatewayTargets(node, outgoing);
  }

  private checkQuestionName(node: BpmnElement): void {
    const name = this.findings.nameOf(node);
    if (name?.trim().endsWith('?')) {
      return;
    }
    this.findings.warning('W_GATEWAY_NAME', `${this.findings.describe(node)} splits but is not named as a question`, ElementText.shownId(node), {
      hint: `Name splitting gateways as a question, e.g. \`bpmn set <file> ${ElementText.shownId(node)} name="Invoice ok?"\`.`,
    });
  }

  private checkBranchNames(node: BpmnElement, outgoing: BpmnElement[]): void {
    const unnamed = outgoing.filter((flow) => !this.findings.nameOf(flow));
    if (!unnamed.length) {
      return;
    }
    this.findings.warning('W_BRANCH_NAME', `Branches ${unnamed.map((element) => ElementText.shownId(element)).join(', ')} of ${this.findings.describe(node)} have no name`, ElementText.shownId(node), {
      related: unnamed.map((element) => ElementText.shownId(element)),
      hint: 'Name each branch with its answer, e.g. `bpmn set <file> <flowId> name=yes`.',
    });
  }

  private checkJoinName(node: BpmnElement): void {
    if (!this.isJoinGateway(node) || !this.findings.nameOf(node)) {
      return;
    }
    this.findings.warning('W_NAMED_JOIN', `Joining gateway ${this.findings.describe(node)} should not have a name`, ElementText.shownId(node), {
      hint: `Unset it: \`bpmn set <file> ${ElementText.shownId(node)} name=\`.`,
    });
  }

  private checkParallelName(node: BpmnElement): void {
    if (!node.is('bpmn:ParallelGateway') || !this.findings.nameOf(node)) {
      return;
    }
    this.findings.warning('W_NAMED_PARALLEL', `Parallel gateway ${this.findings.describe(node)} should not have a name`, ElementText.shownId(node), {
      hint: `Unset it: \`bpmn set <file> ${ElementText.shownId(node)} name=\`.`,
    });
  }

  private checkIgnoredConditions(node: BpmnElement, outgoing: BpmnElement[]): void {
    if (!Kinds.ignoresConditions(node)) {
      return;
    }
    const conditional = outgoing.filter((flow) => flow.peek<BpmnElement | undefined>('conditionExpression'));
    if (!conditional.length) {
      return;
    }
    this.findings.warning('W_CONDITION_IGNORED', `Flows ${conditional.map((element) => ElementText.shownId(element)).join(', ')} out of ${this.findings.describe(node)} have a condition, which the gateway never evaluates`, ElementText.shownId(node), {
      related: conditional.map((element) => ElementText.shownId(element)),
      hint: `Remove them (\`bpmn set <file> ${ElementText.shownId(conditional[0])} condition=\`), or branch by condition: \`bpmn retype <file> ${ElementText.shownId(node)} exclusiveGateway\`.`,
    });
  }

  private checkEventGatewayTargets(node: BpmnElement, outgoing: BpmnElement[]): void {
    if (!node.is('bpmn:EventBasedGateway')) {
      return;
    }
    const targets = outgoing.map((flow) => flow.peek<BpmnElement>('targetRef')).filter((target): target is BpmnElement => !!target);
    for (const target of targets.filter((candidate) => !candidate.is('bpmn:IntermediateCatchEvent') && !candidate.is('bpmn:ReceiveTask'))) {
      this.findings.warning('W_EVENT_GATEWAY_TARGET', `Event-based gateway ${ElementText.shownId(node)} leads to ${this.findings.describe(target)}, which is not a catching event or receive task`, ElementText.shownId(node), {
        related: [ElementText.shownId(target)],
        hint: 'Every branch of an event-based gateway must start with an intermediateCatchEvent (message/timer/signal/conditional) or a receiveTask.',
      });
    }
  }

  private isSplitGateway(node: BpmnElement): boolean {
    return node.is('bpmn:Gateway') && this.document.flows.outgoing(node).length >= 2;
  }

  private isJoinGateway(node: BpmnElement): boolean {
    return node.is('bpmn:Gateway') && this.document.flows.incoming(node).length >= 2 && this.document.flows.outgoing(node).length <= 1;
  }
}

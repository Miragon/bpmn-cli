import { type AnchorContext, type BpmnElement, BpmnError, type ContextWord, ElementLabels } from '../../model/index.js';
import type { AddOperation } from '../../operations/index.js';
import type { EditSession } from '../session/EditSession.js';
import { NodePlacement } from './NodePlacement.js';

type PlacementKey = 'after' | 'before' | 'flow' | 'on' | 'in' | 'to';

export class AddPlacement {
  private static readonly KEYS: readonly PlacementKey[] = ['after', 'before', 'flow', 'on', 'in', 'to'];

  constructor(
    private readonly edit: EditSession,
    private readonly command: AddOperation,
  ) {}

  static reject(command: AddOperation, allowed: readonly PlacementKey[], kind: string): void {
    for (const key of AddPlacement.KEYS) {
      if (command[key] !== undefined && !allowed.includes(key)) {
        throw BpmnError.model('E_INVALID_PLACEMENT', `--${key} does not apply to ${kind}`, {
          hint: allowed.length ? `${kind} accepts ${allowed.map((option) => `--${option}`).join(', ')} only.` : `${kind} takes no placement options.`,
        });
      }
    }
  }

  context(): AnchorContext | undefined {
    const { command } = this;
    switch (NodePlacement.modeOf(command)) {
      case 'after':
      case 'between':
        return this.contextAt('After', command.after);
      case 'before':
        return this.contextAt('Before', command.before);
      case 'flow':
        return this.afterSourceOfFlow();
      case 'on':
        return this.contextAt('On', command.on);
      default:
        return this.scopeContext();
    }
  }

  detail(): string {
    const { command } = this;
    switch (NodePlacement.modeOf(command)) {
      case 'between':
        return `between ${command.after} and ${command.before}`;
      case 'after':
        return `after ${command.after}`;
      case 'before':
        return `before ${command.before}`;
      case 'flow':
        return `in flow ${command.flow}`;
      case 'on':
        return `on ${command.on}`;
      default:
        return `in ${new NodePlacement(this.edit, command).scope().id}`;
    }
  }

  private contextAt(word: ContextWord, id: string | undefined): AnchorContext {
    const element = id ? this.edit.document.tree.byId(id) : undefined;
    return element ? new ElementLabels(element).anchorContext(word) : { context: word };
  }

  private afterSourceOfFlow(): AnchorContext | undefined {
    const source = this.edit.document.tree.byId(this.command.flow!)?.get<BpmnElement | undefined>('sourceRef');
    return source ? new ElementLabels(source).anchorContext('After') : undefined;
  }

  private scopeContext(): AnchorContext | undefined {
    const { document } = this.edit;
    const scope = this.command.in ? document.tree.byId(this.command.in) : undefined;
    if (!scope) {
      return undefined;
    }
    return scope.is('bpmn:SubProcess') || document.tree.processes().length > 1 ? new ElementLabels(scope).anchorContext('In') : undefined;
  }
}

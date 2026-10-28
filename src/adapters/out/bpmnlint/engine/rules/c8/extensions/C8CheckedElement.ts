import { is } from 'bpmnlint-utils';
import { reportErrors } from 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js';

import type { ModdleElement, Reporter, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces } from '../../DiagramNamespaces.js';
import { describeElement } from '../../describe.js';
import { pathFrom } from './utils/pathFrom.js';
import { C8CaughtMessages } from './C8CaughtMessages.js';
import { ZEEBE_URI } from './namespaces.js';
import { ZeebeHint } from './ZeebeHint.js';
import { ZeebeSchema, type ZeebeElementType } from './ZeebeSchema.js';

/**
 * How Camunda 8 treats a zeebe extension element where it sits: `read`, `loose` (a child element
 * outside its container), `flowListeners` (execution listeners on a sequence flow, refused) or
 * `misplaced` (on a host that does not read it).
 */
type ZeebePlacement = 'read' | 'loose' | 'flowListeners' | 'misplaced';

/** A typed zeebe element in the extension elements of a BPMN element. */
export interface ZeebeValue {
  value: ModdleElement;
  /** Its index in `extensionElements.values`. */
  index: number;
  type: ZeebeElementType;
  placement: ZeebePlacement;
}

/** What a report says besides the message: its `data.type`, the element holding the property, its hint, ... */
interface ExtensionFindingData {
  type: string;
  node: ModdleElement;
  hint: string;
  [key: string]: unknown;
}

/**
 * A BPMN element whose vendor content Camunda 8 reads: an element of an executable process (not
 * inside a transaction, which Camunda 8 refuses as a whole) or a message that process uses. A
 * nested element (event definition, loop, condition, or one without an id) is reported on the flow
 * node or flow that holds it, with the path into it.
 */
export class C8CheckedElement {
  private constructor(
    readonly el: ModdleElement,
    private readonly reported: ModdleElement,
    private readonly basePath: ReportPath,
    private readonly owner: ModdleElement | undefined,
  ) {}

  static forNode(node: ModdleElement): C8CheckedElement | undefined {
    if (!C8CheckedElement.isBpmnElement(node) || !C8CheckedElement.isChecked(node)) {
      return undefined;
    }
    const owner = C8CheckedElement.ancestorWithId(node);
    const parent = node.$parent;
    if (parent?.id && C8CheckedElement.isNestedIn(node, parent)) {
      return new C8CheckedElement(node, parent, pathFrom(parent, node), owner);
    }
    if (node.id) {
      return new C8CheckedElement(node, node, [], owner);
    }
    return owner ? new C8CheckedElement(node, owner, pathFrom(owner, node), owner) : undefined;
  }

  /** `serviceTask Activity_1`, `the multiInstanceLoopCharacteristics of serviceTask Activity_1` */
  describe(): string {
    return describeElement(this.el, this.owner);
  }

  /** The `bpmn` commands a hint gives for this element; undefined when `bpmn` cannot address it. */
  hint(): ZeebeHint | undefined {
    return ZeebeHint.of(this.el);
  }

  /** A zeebe name (`zeebe:taskDefinition`) with the prefix the file declares for the zeebe namespace. */
  spell(name: string): string {
    return name.replace(/^zeebe:/, `${ZeebeHint.prefixOf(this.el)}:`);
  }

  /** The path from the reported element to a property of this element. */
  path(...segments: ReportPath): ReportPath {
    return [...this.basePath, ...segments];
  }

  /** The path to the extension element at `index`, or into it. */
  extensionPath(index: number, ...segments: ReportPath): ReportPath {
    return this.path('extensionElements', 'values', index, ...segments);
  }

  /**
   * The keys of the zeebe attributes the moddle left in `$attrs`. A typed parse spells them with
   * the `zeebe` prefix whatever prefix the file declares, so an undeclared `zeebe:` is the zeebe one.
   */
  zeebeAttributeKeys(): string[] {
    const namespaces = DiagramNamespaces.forElement(this.el);
    return Object.keys(this.el.$attrs ?? {}).filter((key) => {
      const uri = namespaces.uriOf(key);
      return uri === ZEEBE_URI || (uri === undefined && key.startsWith('zeebe:'));
    });
  }

  extensionValues(): ModdleElement[] {
    return this.el.extensionElements?.values ?? [];
  }

  /** The typed zeebe elements in the extension elements, with how Camunda 8 treats each. */
  zeebeValues(): ZeebeValue[] {
    const schema = ZeebeSchema.instance;
    return this.extensionValues().flatMap((value, index) => {
      const type = value.$descriptor?.isGeneric ? undefined : schema.typeOf(value);
      return type ? [{ value, index, type, placement: this.placementOf(type) }] : [];
    });
  }

  /** The zeebe elements Camunda 8 reads here, of the given XML name (`zeebe:userTask`). */
  readZeebeValues(name: string): ZeebeValue[] {
    return this.zeebeValues().filter(
      (zeebeValue) => zeebeValue.placement === 'read' && zeebeValue.type.name === name,
    );
  }

  report(
    reporter: Reporter,
    message: string,
    path: ReportPath,
    details: ExtensionFindingData,
  ): void {
    reportErrors(this.reported, reporter, {
      message,
      path,
      data: { ...details, parentNode: details.node === this.reported ? null : this.reported },
    });
  }

  private placementOf(type: ZeebeElementType): ZeebePlacement {
    const schema = ZeebeSchema.instance;
    if (schema.isNestedOnly(type)) {
      return 'loose';
    }
    if (type.name === 'zeebe:executionListeners' && is(this.el, 'bpmn:SequenceFlow')) {
      return 'flowListeners';
    }
    return schema.isReadOn(type, this.el) === false ? 'misplaced' : 'read';
  }

  private static isBpmnElement(node: ModdleElement): boolean {
    const type = String(node?.$type ?? '');
    return (
      type.startsWith('bpmn:') &&
      !is(node, 'bpmn:ExtensionElements') &&
      !is(node, 'bpmn:Definitions') &&
      !node.$descriptor?.isGeneric
    );
  }

  private static isChecked(node: ModdleElement): boolean {
    for (let ancestor = node; ancestor; ancestor = ancestor.$parent) {
      if (is(ancestor, 'bpmn:ExtensionElements')) {
        return false;
      }
      if (ancestor !== node && is(ancestor, 'bpmn:Transaction')) {
        return false;
      }
      if (is(ancestor, 'bpmn:Process')) {
        return ancestor.isExecutable === true;
      }
    }
    return is(node, 'bpmn:Message') && C8CaughtMessages.includes(node);
  }

  private static isNestedIn(node: ModdleElement, parent: ModdleElement): boolean {
    return (
      (parent.eventDefinitions ?? []).includes(node) ||
      parent.loopCharacteristics === node ||
      parent.conditionExpression === node
    );
  }

  private static ancestorWithId(node: ModdleElement): ModdleElement | undefined {
    let ancestor = node.$parent;
    while (ancestor && !ancestor.id) {
      ancestor = ancestor.$parent;
    }
    return ancestor && !is(ancestor, 'bpmn:Definitions') ? ancestor : undefined;
  }
}

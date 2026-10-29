import { is } from 'bpmnlint-utils';

import type { ModdleElement, ReportPath } from '@miragon/bpmnlint-plugin-rules/engine';
import { SetCommand } from './SetCommand.js';

/** Where a finding on a nested element goes: the element it is reported on, and the property path from there, as camunda-compat spells it. */
export class ModdlePath {
  /** The flow node or flow of an event definition, loop or condition, else the nearest element with an id (`node` itself when it has one). */
  static ownerOf(node: ModdleElement): ModdleElement | undefined {
    const parent = node.$parent;
    if (parent?.id && SetCommand.slotIn(parent, node)) return parent;
    let owner = node;
    while (owner && !owner.id) {
      owner = owner.$parent;
    }
    return owner;
  }

  /** The nearest element with an id from `start` up, below `bpmn:Definitions`. */
  static nearestWithId(start: ModdleElement | undefined): ModdleElement | undefined {
    for (let current = start; current && !is(current, 'bpmn:Definitions'); current = current.$parent) {
      if (current.id) return current;
    }
    return undefined;
  }

  /** The property steps from `ancestor` down to `descendant`: `['loopCharacteristics', 'extensionElements', 'values', 0]`. */
  static between(ancestor: ModdleElement, descendant: ModdleElement): ReportPath {
    const steps: ReportPath = [];
    for (let child = descendant; child && child !== ancestor && child.$parent; child = child.$parent) {
      steps.unshift(...ModdlePath.stepInto(child.$parent, child));
    }
    return steps;
  }

  private static stepInto(parent: ModdleElement, child: ModdleElement): ReportPath {
    for (const property of parent.$descriptor?.properties ?? []) {
      const value = parent.get(property.name);
      if (value === child) return [property.ns?.localName ?? property.name];
      if (Array.isArray(value) && value.includes(child)) {
        return [property.ns?.localName ?? property.name, value.indexOf(child)];
      }
    }
    return [];
  }
}

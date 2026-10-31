import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import type { EngineKit } from '../../../engine-kit.js';
import { RuleKit } from '../RuleKit.js';
import { DiagramNamespaces } from './DiagramNamespaces.js';

const BPMN_TYPE = /^(bpmn|bpmndi|dc|di):/;

export interface WrittenFile {
  definitions: ModdleElement;
  namespaces: InstanceType<EngineKit['DocumentNamespaces']>;
  decisionLinks: InstanceType<EngineKit['DecisionLinkReader']>;
}

export class WrittenModel {
  private static readonly recorded = new WeakMap<object, WrittenModel>();

  private readonly writtenByTyped = new WeakMap<object, ModdleElement>();
  private readonly typedByWritten = new WeakMap<object, ModdleElement>();
  private readonly walkOrder = new Map<ModdleElement, number>();

  private constructor(typedDefinitions: ModdleElement, readonly file: WrittenFile) {
    this.pair(typedDefinitions, file.definitions);
    for (const el of RuleKit.kit.walk(file.definitions)) {
      this.walkOrder.set(el, this.walkOrder.size);
    }
  }

  static record(typedDefinitions: ModdleElement, file: WrittenFile): void {
    WrittenModel.recorded.set(typedDefinitions, new WrittenModel(typedDefinitions, file));
  }

  static of(node: ModdleElement): WrittenModel | undefined {
    const definitions = DiagramNamespaces.definitionsOf(node);
    return definitions && WrittenModel.recorded.get(definitions);
  }

  written(typed: ModdleElement): ModdleElement | undefined {
    return this.writtenByTyped.get(typed);
  }

  typed(written: ModdleElement): ModdleElement | undefined {
    return this.typedByWritten.get(written);
  }

  position(written: ModdleElement): number {
    return this.walkOrder.get(written) ?? -1;
  }

  private pair(typed: ModdleElement, written: ModdleElement): void {
    this.writtenByTyped.set(typed, written);
    this.typedByWritten.set(written, typed);
    if (is(typed, 'bpmn:ExtensionElements')) return;
    for (const { name, isAttr, isReference } of typed.$descriptor.properties) {
      if (isAttr || isReference) continue;
      const writtenValues = [written[name]].flat();
      [typed[name]].flat().forEach((value, index) => {
        if (BPMN_TYPE.test(value?.$type) && writtenValues[index]?.$type === value.$type) {
          this.pair(value, writtenValues[index]);
        }
      });
    }
  }
}

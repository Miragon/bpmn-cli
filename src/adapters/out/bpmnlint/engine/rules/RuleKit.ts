import type { EngineKit } from '../../engine-kit.js';

/** What the rules use of bpmn-cli's core (element kinds, the camunda and zeebe descriptors, the edit distance), handed over by the engine run before they lint. */
export class RuleKit {
  static kit: EngineKit;

  static use(kit: EngineKit): void {
    RuleKit.kit = kit;
  }
}

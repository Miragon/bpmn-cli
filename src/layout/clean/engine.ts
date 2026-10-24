import type { Model } from '../../model/utils/moddle.js';
import { CleanEngine, type EngineWarning } from './CleanEngine.js';

export function layoutClean(model: Model, expanded: Set<string>, groups?: ReadonlyMap<string, readonly string[]>): { warnings: EngineWarning[] } {
  return new CleanEngine(model, expanded, groups).run();
}

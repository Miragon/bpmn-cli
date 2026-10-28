import type { Doc } from '../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../domain/document/Finding.js';
import { ioError } from '../../../domain/document/utils/errors.js';
import { firstLine } from '../../../domain/document/utils/text.js';
import type { EnginePlatformInfo } from '../../../domain/validation/EngineLint.js';
import type { EngineLintPort } from '../../../application/port/out/EngineLintPort.js';
import { ENGINE_KIT } from './engine-kit.js';
import type { EngineRun } from './engine/EngineRun.js';

type Engine = EnginePlatformInfo['platform'];

const ENGINE_NAMES: Record<Engine, string> = { c7: 'Camunda 7', c8: 'Camunda 8' };

/**
 * The engine's rules, bpmnlint's linter and the engine run: a chunk of their own
 * per engine in a browser bundle, loaded the first time a document of that engine is checked.
 */
const LOADERS: Record<Engine, () => Promise<EngineRun>> = {
  c7: async () => {
    const [{ Camunda7Rules }, { EngineRun }] = await Promise.all([import('./engine/rules/c7/index.js'), import('./engine/EngineRun.js')]);
    return new EngineRun(ENGINE_KIT, 'c7', Camunda7Rules.entry(ENGINE_KIT));
  },
  c8: async () => {
    const [{ Camunda8Rules }, { EngineRun }] = await Promise.all([import('./engine/rules/c8/index.js'), import('./engine/EngineRun.js')]);
    return new EngineRun(ENGINE_KIT, 'c8', Camunda8Rules.entry(ENGINE_KIT));
  },
};

/**
 * The Camunda 7 / 8 rules as bpmnlint runs them: camunda-compat (through @miragon/bpmnlint-plugin-rules)
 * and bpmn-cli's own rules for what it leaves out, mapped to bpmn-cli's W_C7_* / W_C8_* findings. Each engine
 * loads on first use; a failed load is forgotten, so a later call imports the chunk again (a
 * browser may keep the failed fetch until the page reloads).
 */
export class BpmnlintEngineLint implements EngineLintPort {
  private readonly loading: Partial<Record<Engine, Promise<EngineRun>>> = {};

  async findings(doc: Doc, info: EnginePlatformInfo): Promise<ProfileFinding[]> {
    return (await this.load(info.platform)).findings(doc, info);
  }

  private load(engine: Engine): Promise<EngineRun> {
    const loaded = this.loading[engine];
    if (loaded) return loaded;
    const load = LOADERS[engine]().catch((err: unknown) => {
      delete this.loading[engine];
      throw ioError('E_PROFILE_LOAD', `The ${ENGINE_NAMES[engine]} engine rules could not be loaded: ${firstLine(err)}`, {
        platform: engine,
        hint: 'They are a chunk of their own in a browser bundle: check that it is served next to the entry chunk (base URL, network, content security policy); nothing was written. A later call imports the chunk again (in Node that loads it), but a browser may keep the failed fetch until the page reloads (Chrome does): reload the page there.',
      });
    });
    this.loading[engine] = load;
    return load;
  }
}

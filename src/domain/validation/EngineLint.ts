import type { Doc } from '../document/Doc.js';
import type { ProfileFinding } from '../document/Finding.js';
import type { PlatformInfo } from '../document/vendor/PlatformDetection.js';

/** The platform a document is checked for, once it is an engine. */
export type EnginePlatformInfo = PlatformInfo & { platform: 'c7' | 'c8' };

/**
 * What the engine refuses, ignores or fails on in a document: the Camunda 7 / 8 rules, which
 * the host injects (bpmn-cli's own run bpmnlint with the Miragon engine layers).
 */
export interface EngineLint {
  findings(doc: Doc, info: EnginePlatformInfo): Promise<ProfileFinding[]>;
}

import type { IdConventions } from '../document/ids/IdConventions.js';
import type { DebugSink } from '../diagram/layout/LayoutDebug.js';
import type { DrawingOptions, LayoutStatus } from '../diagram/types.js';
import type { ChangeSet } from '../document/ChangeSet.js';
import type { PlatformChoice } from '../document/vendor/PlatformDetection.js';
import type { ValidationResult } from '../validation/StructuralValidator.js';
import type { ValidationDelta } from '../validation/FindingBaseline.js';
import type { Validator } from '../validation/validators.js';
import type { EngineLint } from '../validation/EngineLint.js';
import type { ModelView } from '../views/model-view.js';

/** How one batch runs: its layout, guards, validators and id conventions. */
export interface MutationOptions extends DrawingOptions {
  /** write despite lossy import / validation errors */
  force?: boolean;
  show?: boolean;
  /** platform profile whose new findings are reported: 'auto' (default), 'none' switches it off */
  platform?: PlatformChoice;
  /** the Camunda 7 / 8 rules; without them a change reports no platform findings */
  engine?: EngineLint;
  /** receives the layout engines' diagnostic lines during this call */
  debug?: DebugSink;
  /** run on the candidate XML; errors the change introduces block the write */
  validators?: Validator[];
  /** the file being written, for the validators; default doc.file */
  file?: string;
  /** declared id conventions, followed by generated ids where they declare a prefix */
  conventions?: IdConventions;
}

export interface MutationResult {
  ok: true;
  file?: string;
  /** always false from the in-memory pipeline; an `unchanged` result is not written back */
  written: boolean;
  /** the result is the input text byte for byte */
  unchanged: boolean;
  changes: ChangeSet;
  /** batch aliases (`"as": "$name"`) -> the final id of their element */
  aliases?: Record<string, string>;
  layout: LayoutStatus;
  validation: ValidationResult;
  importWarnings: string[];
  /**
   * the findings the change added and resolved against the document before the ops;
   * absent for a document created in memory
   */
  delta?: ValidationDelta;
  view?: ModelView;
  xml: string;
}

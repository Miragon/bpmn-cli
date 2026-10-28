import type { LayoutWarningInfo } from './layout/FullLayout.js';
import type { MetricsDelta } from './utils/problems.js';
import type { DiagramCommandResult } from './commands/DiagramCommands.js';

/** How a batch draws: its layout mode and the sub-processes to expand or collapse. */
export interface DrawingOptions {
  /**
   * false skips the layout; true / 'auto' (default) keeps a hand-made drawing and redraws
   * an engine-owned one
   */
  layout?: boolean | LayoutMode;
  /** additional sub-process ids to expand / collapse */
  expand?: string[];
  collapse?: string[];
}

export type LayoutMode = 'auto' | 'incremental' | 'full';

export const LAYOUT_MODES: readonly LayoutMode[] = ['auto', 'incremental', 'full'];

export interface LayoutStatus {
  status: 'ok' | 'skipped';
  mode?: 'full' | 'incremental';
  reason?: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** incremental: elements that got new DI */
  placed?: string[];
  /** incremental: pre-existing shapes whose bounds changed */
  moved?: string[];
  /** incremental: pre-existing connections that were routed again */
  rerouted?: string[];
  /** incremental: pre-existing connections stretched or shortened without being routed again */
  reshaped?: string[];
  pruned?: string[];
  notes?: string[];
  /** layout problems before / after, and the difference */
  metrics?: MetricsDelta;
  /** in batch order */
  format?: DiagramCommandResult[];
  /** design-iq stickies moved along with their flow node (`<processId>#<n>` without id) */
  stickies?: Array<{ sticky: string; node: string }>;
}

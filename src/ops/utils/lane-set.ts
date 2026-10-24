import { is, type El } from '../../model/utils/moddle.js';

/** The lane set whose lanes `owner` orders: a process's (first), a participant's process's, a lane's child lanes. */
export function laneSetOf(owner: El): El | undefined {
  if (is(owner, 'bpmn:Lane')) return owner.get<El | undefined>('childLaneSet');
  const process = is(owner, 'bpmn:Participant') ? owner.get<El | undefined>('processRef') : owner;
  if (!process) return undefined;
  return (process.get<El[] | undefined>('laneSets') ?? [])[0];
}

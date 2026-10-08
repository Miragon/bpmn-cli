/**
 * Self-description for agents: `bpmn kinds`, `bpmn kinds --json`, `bpmn guide`.
 *
 * Everything here is derived from the live tables (KINDS, SET_KEYS, the ops
 * field specs and schema) so the text can never drift from the code; only
 * the error catalogue, exit codes, trigger options, placement rules and the
 * command reference are written by hand.
 */
import { EXIT_CODES } from './errors.js';
import { KINDS, TRIGGER_TYPES, type Family, type KindDef, type Trigger } from './kinds.js';
import { SET_KEYS, type SetKeyDoc } from './ops/set.js';
import { OP_NAMES } from './ops/types.js';
import { OPS_SCHEMA, OP_DESCRIPTIONS, OP_FIELDS, opsExample } from './batch.js';
import { SWATCHES } from './diagram/write.js';
import { LAYOUT_MODES } from './pipeline.js';

/* ------------------------------------------------------------------ */
/* error catalogue                                                      */
/* ------------------------------------------------------------------ */

export interface ErrorDoc {
  code: string;
  meaning: string;
  fix: string;
}

/**
 * Every E_/W_ code the CLI can emit (kept complete by test/batch.test.ts,
 * which greps src/ for codes).
 */
export const ERROR_CATALOGUE: ErrorDoc[] = [
  // usage / I/O
  { code: 'E_USAGE', meaning: 'Bad command line or ops JSON (unknown command, option, op, key or value type).', fix: 'Read the message (it names the op index and the allowed keys), then `bpmn <command> --help` or `bpmn guide`.' },
  { code: 'E_FILE_NOT_FOUND', meaning: 'The .bpmn file does not exist.', fix: 'Check the path, or create the file with `bpmn new <file>`.' },
  { code: 'E_IO', meaning: 'Reading or writing the file failed (permissions, directory missing, ...).', fix: 'Check the path and permissions; use -o <file> to write elsewhere.' },
  { code: 'E_PARSE', meaning: 'The file is not well-formed BPMN XML or its root is not bpmn:definitions.', fix: 'Fix the XML (or start over with `bpmn new`); the message points to the first problem.' },
  { code: 'E_IMPORT_LOSSY', meaning: 'bpmn-moddle dropped content while importing (unparsable/unknown elements, unresolved references, duplicate ids); writing would lose it. The library refuses it too (Doc.fromXml + mutateDoc).', fix: 'Inspect the warnings with `bpmn validate <file>`, fix the XML, or write anyway with --force (library: force: true; the reported content is dropped).' },
  { code: 'E_NO_FILE', meaning: 'No output file: the document was not loaded from a file and no -o/--out was given.', fix: 'Pass -o <file>.' },
  { code: 'E_FILE_EXISTS', meaning: '`bpmn new` refuses to overwrite an existing file.', fix: 'Choose another name, or pass --force to overwrite.' },
  { code: 'E_INVALID_XML', meaning: 'The --xml snippet of `ext add` could not be parsed.', fix: 'Pass one well-formed element with declared prefixes, e.g. --xml \'<zeebe:taskDefinition type="x"/>\', or use <prefix:type> attr=value instead.' },
  // ids & lookup
  { code: 'E_NOT_FOUND', meaning: 'No element with the given id. Ids of vendor extension elements (e.g. camunda:formField) are not element ids: the message then names the BPMN element they belong to.', fix: 'Use the candidates listed, or run `bpmn show <file>` / `bpmn find <file> <text>` to list ids. `remove --if-exists` / `add --if-absent` make the op idempotent.' },
  { code: 'E_WRONG_KIND', meaning: 'The element exists but is not of the expected kind (e.g. a flow where a node is required).', fix: 'Pass an id of the right kind; `bpmn show <file> <id>` prints the kind.' },
  { code: 'E_INVALID_ID', meaning: 'The id is not an XML NCName ([A-Za-z_][A-Za-z0-9_.-]*).', fix: 'Use letters, digits, _ . - and start with a letter or _, e.g. Activity_CheckInvoice.' },
  { code: 'E_DUPLICATE_ID', meaning: 'An element with that id already exists (BPMN and diagram elements only: ids inside vendor extension elements, e.g. two camunda:formField with the same id in different forms, are not checked).', fix: 'Choose another --id, omit it (ids are generated from the name), or use --if-absent.' },
  { code: 'E_UNKNOWN_KIND', meaning: 'The kind token is not a known kind, alias or bpmn type.', fix: 'Run `bpmn kinds`; the message suggests close matches.' },
  { code: 'E_UNSUPPORTED_KIND', meaning: 'The kind exists in BPMN but is not supported (complexGateway, choreographies, groups).', fix: 'Model it differently, e.g. exclusiveGateway/inclusiveGateway instead of complexGateway.' },
  { code: 'E_UNKNOWN_KEY', meaning: '`set` got a key that is not settable on this element.', fix: 'The message lists the settable keys; `bpmn kinds` has the full set-key table. Vendor attributes need a prefix (camunda:assignee).' },
  { code: 'E_INVALID_VALUE', meaning: 'A value is not acceptable: empty condition, bad enum value, option on the wrong connection kind, ...', fix: 'Quote expressions with single quotes (\'${ok}\'), check the allowed values in the message.' },
  { code: 'E_UNKNOWN_NAMESPACE', meaning: 'A vendor prefix (e.g. `acme:`) has no known xmlns.', fix: 'Use a known prefix (camunda, zeebe, modeler, bioc, color) or declare the namespace on bpmn:definitions in the file.' },
  // scope & placement
  { code: 'E_NO_PROCESS', meaning: 'The file contains no process.', fix: 'Create one with `bpmn new`, or add a participant.' },
  { code: 'E_AMBIGUOUS_SCOPE', meaning: 'The file has several processes and the command did not say which one.', fix: 'Add --in <processId|subProcessId|participantId>.' },
  { code: 'E_BLACK_BOX', meaning: 'The participant has no process (black-box pool), so nothing can be placed in it.', fix: 'Pick a participant with a process, or create a new pool without --black-box.' },
  { code: 'E_INVALID_SCOPE', meaning: 'The --in container does not fit the kind: data objects and text annotations need a process, sub-process or participant, lanes need a process, participant or lane, not a sub-process.', fix: 'Pass --in <processId|subProcessId|participantId> (lanes: or a lane id for nesting).' },
  { code: 'E_PROCESS_BOUND', meaning: '`add participant --process <id>`: that process is already bound to another participant.', fix: 'Omit --process to create a new process for the pool, or use --black-box.' },
  { code: 'E_MULTIPLE_ROOTS', meaning: 'Several root processes exist without a collaboration; the layouter draws only one root.', fix: 'Wrap the processes in pools (`bpmn add <file> participant <name> --process <processId>`), or remove the extra processes.' },
  { code: 'E_ORPHAN_PROCESS', meaning: 'A collaboration exists but this process is not referenced by any participant, so it would not be drawn.', fix: 'Add a participant for it (`bpmn add <file> participant <name> --process <processId>`) or remove it.' },
  { code: 'E_INVALID_PLACEMENT', meaning: 'The placement does not fit the kind: --on for a non-boundary node, a boundary event without --on, --after for data objects / annotations / lanes.', fix: 'Boundary events: --on <activityId>. Flow nodes: --after/--before/--flow/--in. Data, annotations, lanes, pools: --in only, then `connect`.' },
  { code: 'E_HAS_SUCCESSOR', meaning: '--after <X>: X already has several outgoing flows, so it is unclear where to insert.', fix: 'Use --flow <flowId> (candidates are listed) or --after X --before <targetId>.' },
  { code: 'E_HAS_PREDECESSOR', meaning: '--before <Y>: Y already has several incoming flows.', fix: 'Use --flow <flowId> (candidates are listed) or --after <sourceId> --before Y.' },
  { code: 'E_NO_FLOW', meaning: '--after X --before Y: there is no sequence flow X -> Y.', fix: 'Check `bpmn show <file> X` for its outgoing flows, or use --after X alone / --flow <id>.' },
  { code: 'E_AMBIGUOUS_FLOW', meaning: '--after X --before Y: there are several flows X -> Y.', fix: 'Use --flow <flowId> with one of the listed candidates.' },
  { code: 'E_CROSS_SCOPE', meaning: 'A sequence flow would cross a process / sub-process / pool boundary.', fix: 'Use a message flow between pools (`connect` infers it), or move the node with `bpmn move <id> --in <scope>`.' },
  { code: 'E_INVALID_SOURCE', meaning: 'The element cannot be the source of a sequence flow (end event, event sub-process, non-flow-node).', fix: 'Start the flow from a task, gateway, start/intermediate event or boundary event.' },
  { code: 'E_INVALID_TARGET', meaning: 'The element cannot be the target of a sequence flow (start event, boundary event, event sub-process, non-flow-node).', fix: 'End the flow at a task, gateway, intermediate or end event.' },
  { code: 'E_INVALID_ENDPOINT', meaning: '`connect` found no connection kind for these endpoints (e.g. message flow to a gateway, association between two tasks).', fix: 'Message flows join pools, tasks, events and sub-processes across pools; associations need a text annotation; data associations need a data object/store.' },
  { code: 'E_NO_COLLABORATION', meaning: '`connect` would need a message flow, but the file has no collaboration (no pools).', fix: 'Add participants first: `bpmn add <file> participant "<name>"` wraps the existing process, a second one gets its own process.' },
  { code: 'E_NO_PARTICIPANT', meaning: 'A message flow endpoint is not inside any participant; message flows only connect pools.', fix: 'Bind its process to a pool: `bpmn add <file> participant "<name>" --process <processId>`.' },
  { code: 'E_SAME_POOL', meaning: '`connect` between two elements of the same pool where a message flow was requested (e.g. --message given).', fix: 'Use a plain sequence flow inside a pool; message flows connect different pools.' },
  { code: 'E_INVALID_DEFAULT', meaning: 'Only exclusive/inclusive gateways and activities can have a default flow.', fix: 'Drop --default, or make the source an exclusiveGateway.' },
  { code: 'E_NOT_OUTGOING', meaning: '`order` got a flow that is not an outgoing flow of the node.', fix: 'List only the node\'s outgoing flow ids (`bpmn show <file> <nodeId>`).' },
  { code: 'E_INVALID_LANE_MEMBERSHIP', meaning: 'Nodes inside sub-processes cannot be lane members; lanes only contain top-level nodes of their process.', fix: 'Assign the sub-process itself to the lane.' },
  { code: 'E_NOT_CHILD_LANE', meaning: '`order` with lanes: a listed lane is not a direct child lane of the given pool / process / parent lane.', fix: 'List lanes of one level (the candidates are listed); order nested lanes with their parent lane as id: `bpmn order <file> <parentLaneId> <laneIds...>`.' },
  // format operations (diagram only)
  { code: 'E_NO_DIAGRAM', meaning: 'The file has no diagram (DI), so a format operation (place, align, color, label, route, space, tidy) has nothing to work on.', fix: 'Draw it first with `bpmn layout <file>`, or drop --no-layout (a file without diagram is then drawn in full before the format operation runs).' },
  { code: 'E_NO_SHAPE', meaning: 'The element exists but has no shape or connection in the diagram (added with --no-layout, a process that is drawn as its pool, an element outside the drawn root).', fix: 'For a pool use the participant id, not the process id. Otherwise draw it: `bpmn layout <file>` (or any write without --no-layout).' },
  { code: 'E_DIFFERENT_DIAGRAM', meaning: '`place` / `align`: the element and its reference are drawn on different diagrams (the content of a collapsed sub-process has its own).', fix: 'Use a reference on the same diagram, or expand the sub-process first (`bpmn set <file> <subProcessId> expanded=true`).' },
  { code: 'E_LEAVES_CONTAINER', meaning: '`place` / `align` would move a node out of its lane, pool or expanded sub-process (its centre would leave the frame).', fix: 'Change the membership first (`bpmn move <file> <id> --lane <laneId>`; in a batch a move op before the place op; the hint names the lane at the target position), or choose a reference inside the frame.' },
  { code: 'E_NO_ROOM', meaning: '`place` / `align`: there is no room for the request: after the shapes in the way gave way, the requested row / column no longer holds (e.g. a node placed onto its own reference, or into a gap that is too small next to it), or the lane / sub-process of the moved shape would have to grow over a reference outside it, or push the reference\'s own pool / lane / sub-process away, or two shapes would end up on each other (a reference that would be overrun moves along when its row / column still holds).', fix: 'Make room first (`bpmn space <file> --after <id>` / `--below <id>`) and place again, or use a reference inside the same lane / sub-process.' },
  { code: 'E_NO_LABEL', meaning: '`label`: the element has no name, so there is no label to place.', fix: 'Name it first: `bpmn set <file> <id> name=...`.' },
  // validation (structural errors block writes; `bpmn validate` lists them)
  { code: 'E_DANGLING_REF', meaning: 'A reference (sourceRef, targetRef, attachedToRef, processRef, default, flowNodeRef, ...) points to an element that is not in the model.', fix: 'Remove the referencing element (`bpmn remove <id>`) or re-point it with `bpmn set <id> source=/target=`; usually a hand-edited file.' },
  { code: 'E_FLOW_LINKS', meaning: 'A sequence flow and its endpoints disagree: the flow is missing from node.outgoing/incoming, or a node lists a flow that does not touch it.', fix: 'Remove and re-create the flow (`bpmn remove <flowId>`, `bpmn connect <src> <tgt>`).' },
  { code: 'E_EMPTY_COLLABORATION', meaning: 'The collaboration has no participant with a process (only black boxes or none at all), so nothing would be drawn.', fix: 'Add a pool with a process (`bpmn add <file> participant <name>` wraps the existing process) or remove the collaboration.' },
  { code: 'E_NO_HOST', meaning: 'A boundary event is not attached to any activity.', fix: 'Remove it, or re-create it with `bpmn add <file> boundary:<trigger> --on <activityId>`.' },
  { code: 'E_INVALID_HOST', meaning: 'A boundary event is attached to a non-activity, or to an activity in another scope.', fix: 'Attach it to a task/sub-process of the same scope (`--on <activityId>`), or move it with `bpmn move <id> --in <scope>`.' },
  { code: 'E_EVENT_SUBPROCESS_NO_START', meaning: 'An event sub-process has no (triggered) start event.', fix: 'Create the event sub-process with its trigger in one command: `bpmn add <file> eventSubProcess:<message|timer|signal|conditional|error|escalation|compensate> "<Name>" --in <scope> [--error X | --message X | --timer PT1H ...]` (the start event is created inside), or use one `bpmn apply` batch that adds the sub-process and its startEvent:<trigger> together.' },
  { code: 'E_EVENT_SUBPROCESS_PLAIN_START', meaning: 'A start event inside an event sub-process has no trigger.', fix: 'Give it one: `bpmn set <file> <startId> trigger=<message|timer|error|...>` (plus --message/--timer/... values via `retype`).' },
  { code: 'E_INVALID_LANE_MEMBER', meaning: 'A lane lists an element that is not a flow node of its process.', fix: 'Remove the member from the lane (`bpmn set <file> <nodeId> lane=`) or delete the lane.' },
  { code: 'E_LANE_CONFLICT', meaning: 'A node is a member of several lanes.', fix: 'Assign it to exactly one lane: `bpmn set <file> <nodeId> lane=<laneId>` (or `bpmn move <nodeId> --lane <laneId>`).' },
  { code: 'E_INVALID_MESSAGE_FLOW', meaning: 'A message flow ends at an element that cannot send or receive messages (gateway, data object, ...).', fix: 'Connect pools, tasks, events or sub-processes instead.' },
  { code: 'E_MESSAGE_FLOW_SAME_POOL', meaning: 'A message flow connects two elements inside the same pool.', fix: 'Use a sequence flow inside a pool; message flows only cross pool boundaries.' },
  // events & retype
  { code: 'E_TRIGGER_REQUIRED', meaning: 'Boundary events need a trigger.', fix: 'Use boundaryEvent:<trigger> with its option, e.g. boundary:timer --timer PT2D or boundary:error --error PaymentFailed.' },
  { code: 'E_INVALID_TRIGGER', meaning: 'The trigger is not allowed here: e.g. startEvent:error outside an event sub-process, --non-interrupting on an error/cancel/compensate boundary event, a trigger the kind does not support.', fix: '`bpmn kinds` shows the allowed triggers per event kind; error/escalation/compensate start events go inside an eventSubProcess.' },
  { code: 'E_INVALID_REMOVE', meaning: '`remove` was asked to delete the bpmn:Definitions root.', fix: 'Delete the file instead; remove processes, participants or elements.' },
  { code: 'E_NO_CONDITION', meaning: '`set language=...` on a sequence flow that has no condition expression.', fix: 'Set condition=<expression> together with language.' },
  { code: 'E_NO_EXTENSION', meaning: '`ext remove`: the element has no extension elements, none of the given type, or the index is out of range.', fix: 'Run `bpmn ext list <file> <id>` and remove by an existing type or index.' },
  { code: 'W_BLACK_BOX', meaning: '`remove`: a participant lost its process and is now a black-box pool.', fix: 'Remove the participant too, or bind a new process to it.' },
  { code: 'W_DANGLING_CALLED_ELEMENT', meaning: '`remove`: a call activity still references the removed process id via calledElement.', fix: '`bpmn set <file> <callActivityId> calledElement=<processId>` or remove the call activity.' },
  { code: 'W_FLOW_DROPPED', meaning: '`move`: a sequence flow was removed because it would cross scopes after the move (also for boundary events that followed their host).', fix: 'Reconnect the node inside its new scope with `bpmn connect`.' },
  { code: 'E_WOULD_DROP_CONTENT', meaning: '`retype` to a kind that cannot hold the element\'s content (a sub-process with nodes -> task / callActivity) would delete that content; nothing was written. The ids are listed.', fix: 'Move what should stay out first (`bpmn move <file> <ids> --in <scopeId>`), or pass --force to retype anyway (the listed elements are deleted).' },
  { code: 'E_INVALID_RETYPE', meaning: '`retype` between incompatible families (e.g. task -> gateway, start -> end event).', fix: 'Retype within a family (task <-> task/subProcess/callActivity, gateway <-> gateway, event <-> event of the same position); otherwise remove and add.' },
  // write-time
  { code: 'E_VALIDATION', meaning: 'The change would introduce structural errors, so the file was not written (the new errors are listed in the details; errors the file already had do not block, see W_PREEXISTING_ERROR).', fix: 'Run `bpmn validate <file>` and fix the listed problems (every finding has its own code and hint), or pass --force to write anyway.' },
  { code: 'E_LAYOUT_*', meaning: 'The layout engine could not draw the model (e.g. E_LAYOUT_ERROR); the suffix is the layouter\'s own code, the message names the element.', fix: 'Check the element named in the message (unsupported kind, broken flow graph), or write without DI using --no-layout and run `bpmn layout` later.' },
  { code: 'E_LAYOUT_INCREMENTAL', meaning: '`--layout incremental` was requested and the incremental layout (keep the drawing, place what is new) failed; nothing was written.', fix: 'Retry with --layout full (redraws the whole diagram) or --no-layout (writes without updating the diagram), and report the command and file.' },
  { code: 'E_INTERNAL', meaning: 'An unexpected internal error (exit 70).', fix: 'Re-run with --json (or BPMN_DEBUG=1 for a stack trace) and report the command and file.' },
  // warnings
  { code: 'W_ID_SUFFIXED', meaning: 'The generated id from the name already existed, so a _2/_3 suffix was appended.', fix: 'Use the reported id, or pass --id to choose one yourself.' },
  { code: 'W_KIND_MISMATCH', meaning: '`add --if-absent`: the id exists but with another kind; nothing was changed.', fix: 'Use `bpmn retype <file> <id> <kind>` to change its kind, or pick another id.' },
  { code: 'W_OPTION_IGNORED', meaning: 'An option does not apply to the kind (trigger options on a task, --collapsed on a non-sub-process, --lane on a data object) and was ignored.', fix: 'Drop the option, or use the kind it applies to.' },
  { code: 'W_LANES_WITHOUT_POOL', meaning: 'The process has lanes but no participant; lanes are only drawn inside a pool.', fix: 'Add a pool: `bpmn add <file> participant "<name>"` (it wraps the existing process).' },
  { code: 'W_LAYOUT_*', meaning: 'The layout engine reported a warning while drawing (suffix = the layouter\'s code); the diagram was still written.', fix: 'Check the named element; usually a node the layouter could not place nicely (e.g. unreachable or oddly connected).' },
  { code: 'W_LAYOUT_INCREMENTAL_FAILED', meaning: 'Layout mode auto: keeping the hand-made drawing failed (incremental layout error, or a diagram with vertical pools / lanes, which only a full redraw handles), so the whole diagram was redrawn; colours were carried over, positions were not.', fix: 'Check the result (`bpmn show <file> --layout`); report the command and file. To refuse instead of redrawing, pass --layout incremental.' },
  // lint (from `bpmn validate` and after every write)
  { code: 'W_NO_START', meaning: 'A process or sub-process has no start event.', fix: '`bpmn add <file> startEvent "<name>" --before <firstNodeId>` (or --in <scope>).' },
  { code: 'W_NO_END', meaning: 'A process or sub-process has no end event.', fix: '`bpmn add <file> endEvent "<name>" --after <lastNodeId>`.' },
  { code: 'W_UNREACHABLE', meaning: 'A node is not reachable from any start event.', fix: 'Connect it (`bpmn connect` / `bpmn move --after`) or remove it.' },
  { code: 'W_DEAD_END', meaning: 'A non-end node has no outgoing flow.', fix: 'Connect it to the next node or to an end event (`bpmn add <file> endEvent --after <id>`).' },
  { code: 'W_GATEWAY_NAME', meaning: 'A splitting exclusive/inclusive gateway is not named as a question.', fix: '`bpmn set <file> <gatewayId> name="Invoice ok?"`.' },
  { code: 'W_BRANCH_NAME', meaning: 'Outgoing flows of a splitting exclusive/inclusive gateway have no names.', fix: '`bpmn set <file> <flowId> name=yes` for each branch.' },
  { code: 'W_NAMED_JOIN', meaning: 'A joining gateway has a name (convention: joins are unnamed).', fix: '`bpmn set <file> <gatewayId> name=`.' },
  { code: 'W_NAMED_PARALLEL', meaning: 'A parallel gateway has a name (convention: parallel gateways are unnamed).', fix: '`bpmn set <file> <gatewayId> name=`.' },
  { code: 'W_NOT_IN_LANE', meaning: 'The process has lanes but this node is in none of them.', fix: '`bpmn set <file> <nodeId> lane=<laneId>` or `bpmn move <nodeId> --lane <laneId>`.' },
  { code: 'W_EVENT_GATEWAY_TARGET', meaning: 'An event-based gateway leads to something other than a catching event or receive task.', fix: 'Put intermediateCatchEvent:<message|timer|signal|conditional> or receiveTask nodes directly after the gateway.' },
  { code: 'W_EMPTY_SUBPROCESS', meaning: 'A sub-process contains no nodes.', fix: '`bpmn add <file> startEvent --in <subProcessId>` and build its content, or remove it.' },
  { code: 'W_DUPLICATE_NAME', meaning: 'Several elements of the same kind share a name.', fix: 'Rename with `bpmn set <file> <id> name=...` unless intended.' },
  { code: 'W_IMPLICIT_SPLIT', meaning: 'A non-gateway node got a second outgoing flow (implicit parallel split).', fix: 'Route the branches through a gateway: a `split` op in `bpmn apply` (split exists only as an apply op, not as a command) or `bpmn add <file> exclusiveGateway --after <id>` plus `connect`; ignore it when the implicit split is intended.' },
  { code: 'W_IMPLICIT_JOIN', meaning: 'A non-gateway node got a second incoming flow (implicit join: every token runs the node again).', fix: 'Join through a gateway unless the repeated execution is intended.' },
  { code: 'W_LABEL_DROPPED', meaning: 'While bridging a removed node the outgoing flow label could not be carried over because the incoming flow has its own.', fix: 'Set the wanted label on the surviving flow with `bpmn set <file> <flowId> name=...`.' },
  { code: 'W_CONDITION_DROPPED', meaning: 'While bridging a removed node the outgoing flow condition could not be carried over.', fix: 'Set the condition on the surviving flow with `bpmn set <file> <flowId> condition=...`.' },
  { code: 'W_PROPERTY_DROPPED', meaning: '`retype` dropped a property the new kind does not have (e.g. script on a userTask), or a trigger kind change (`set trigger=`, `retype`) dropped vendor attributes / extension elements of the old event definition (changing only the details of the same trigger keeps the definition).', fix: 'Re-add the information in a form the new kind supports, or accept the loss.' },
  { code: 'W_PREEXISTING_ERROR', meaning: 'A structural error the model already had before this change (the message starts with its E_ code); it does not block the write.', fix: 'Fix it when convenient: `bpmn validate <file>` lists it with its own code and hint.' },
];

/* ------------------------------------------------------------------ */
/* exit codes                                                           */
/* ------------------------------------------------------------------ */

export const EXIT_CODE_DOCS: Array<{ code: number; meaning: string }> = [
  { code: 0, meaning: 'ok (warnings allowed)' },
  { code: EXIT_CODES.usage, meaning: 'usage error: unknown command/option, bad ops JSON (E_USAGE)' },
  { code: EXIT_CODES.model, meaning: 'model or validation error (E_NOT_FOUND, E_CROSS_SCOPE, ...)' },
  { code: EXIT_CODES.layout, meaning: 'layout error (E_LAYOUT_*)' },
  { code: EXIT_CODES.io, meaning: 'I/O or parse error (E_FILE_NOT_FOUND, E_PARSE, E_IMPORT_LOSSY, E_FILE_EXISTS)' },
  { code: 5, meaning: '--strict and the result has warnings' },
  { code: EXIT_CODES.internal, meaning: 'internal error' },
];

/* ------------------------------------------------------------------ */
/* triggers                                                             */
/* ------------------------------------------------------------------ */

export interface TriggerOptionDoc {
  trigger: Trigger;
  /** the CLI option(s) */
  option: string;
  /** the ops JSON key(s) */
  keys: string[];
  description: string;
}

export const TRIGGER_OPTIONS: TriggerOptionDoc[] = [
  { trigger: 'none', option: '(no option)', keys: [], description: 'plain event; the default for start/end/throw events in `add` (`retype` keeps the current trigger unless the suffix :none is given)' },
  { trigger: 'message', option: '--message <name>', keys: ['message'], description: 'root bpmn:Message found by name, created when missing' },
  { trigger: 'timer', option: '--timer <iso> [--timer-kind cycle|duration|date]', keys: ['timer', 'timerKind'], description: 'R/PT1H -> timeCycle, PT2D -> timeDuration, 2026-01-31T09:00:00Z -> timeDate (auto-classified)' },
  { trigger: 'error', option: '--error <name> [--error-code <code>]', keys: ['error', 'errorCode'], description: 'root bpmn:Error by name, created when missing' },
  { trigger: 'signal', option: '--signal <name>', keys: ['signal'], description: 'root bpmn:Signal by name, created when missing' },
  { trigger: 'escalation', option: '--escalation <name> [--escalation-code <code>]', keys: ['escalation', 'escalationCode'], description: 'root bpmn:Escalation by name, created when missing' },
  { trigger: 'conditional', option: '--when <expr>', keys: ['when'], description: 'condition expression' },
  { trigger: 'link', option: '--link <name>', keys: ['link'], description: 'a throwing and a catching link event pair up by name' },
  { trigger: 'compensate', option: '(no option)', keys: [], description: 'compensation' },
  { trigger: 'terminate', option: '(no option)', keys: [], description: 'terminate end event' },
  { trigger: 'cancel', option: '(no option)', keys: [], description: 'transaction cancel' },
];

export const NON_INTERRUPTING_DOC = '--non-interrupting (nonInterrupting): boundary events get cancelActivity=false, start events of an event sub-process isInterrupting=false; not allowed on error/cancel/compensate boundary events.';

/** Event kinds that allow a trigger. */
export function kindsWithTrigger(trigger: Trigger): string[] {
  return KINDS.filter((k) => k.triggers?.includes(trigger)).map((k) => k.kind);
}

/* ------------------------------------------------------------------ */
/* placement                                                            */
/* ------------------------------------------------------------------ */

export interface PlacementDoc {
  option: string;
  key: string;
  rule: string;
}

export const PLACEMENT_DOCS: PlacementDoc[] = [
  { option: '--after <X>', key: 'after', rule: 'X is a gateway or has no outgoing flow: append X -> node. X has exactly one outgoing flow: splice, X -> node -> old successor. Otherwise E_HAS_SUCCESSOR (say which flow).' },
  { option: '--before <Y>', key: 'before', rule: 'Symmetric: prepend before a join gateway or a node without incoming flow, else splice into its single incoming flow; several incoming flows -> E_HAS_PREDECESSOR.' },
  { option: '--after <X> --before <Y>', key: 'after + before', rule: 'Splice into the flow X -> Y (E_NO_FLOW / E_AMBIGUOUS_FLOW when there is none / several).' },
  { option: '--flow <F>', key: 'flow', rule: 'Splice into sequence flow F: A -> B becomes A -> node -> B. F keeps its id, name and condition and now ends at the node.' },
  { option: '--in <S>', key: 'in', rule: 'Put the node into process / sub-process / participant S without connecting it (connect it afterwards).' },
  { option: '--on <A>', key: 'on', rule: 'Boundary events only: attach to activity A.' },
  { option: '--to <T>', key: 'to', rule: 'Additionally connect node -> T (a branch that re-joins the main path).' },
];

export const PLACEMENT_NOTES: string[] = [
  'Exactly one placement per add/move (after + before counts as one). Without any, the node is appended to the only process, unconnected.',
  'Flow options --flow-name / --flow-id / --condition / --language / --default describe the flow INTO the new node (from the anchor).',
  'Branch order in the diagram: the default flow (else the first outgoing flow that leads to an end event, else the first one) continues straight; the other branches go alternately below and above it in declaration order (all below when a default flow exists). `bpmn order` changes the declaration order, `set <flowId> default=true` picks the continuation.',
  'Data objects, data stores, text annotations, lanes and pools take --in only; wire them with `bpmn connect`.',
];

/* ------------------------------------------------------------------ */
/* commands                                                             */
/* ------------------------------------------------------------------ */

export interface CommandDoc {
  name: string;
  usage: string;
  summary: string;
  examples: string[];
}

export const COMMANDS: CommandDoc[] = [
  { name: 'new', usage: 'bpmn new <file> [--name <text>] [--id <processId>] [--no-executable] [--target camunda8|camunda7]', summary: 'Create a file with one empty process.', examples: ['bpmn new order.bpmn --name "Order handling" --target camunda8'] },
  { name: 'show', usage: 'bpmn show <file> [<id>] [--json] [--scope <id>] | bpmn show <file> --layout [--json]', summary: 'Print the model in flow order (no coordinates), or every detail of one element. --layout prints the drawing instead: per pool / lane the rows of node ids (left to right), colours, labels off their default side and the layout problems with ids.', examples: ['bpmn show order.bpmn', 'bpmn show order.bpmn Activity_CheckInvoice --json', 'bpmn show order.bpmn --layout'] },
  { name: 'find', usage: 'bpmn find <file> <text> [--kind <kind>] [--json]', summary: 'Find elements by id or name substring; --kind accepts any kind plus sequenceFlow, messageFlow, association, dataAssociation, process, collaboration, message, error, signal, escalation.', examples: ['bpmn find order.bpmn invoice --kind userTask'] },
  { name: 'add', usage: 'bpmn add <file> <kind[:trigger]> [<name>] [--id <id>] [placement] [--to <id>] [--lane <laneId>] [flow options] [trigger options] [--collapsed] [--if-absent] [--doc <text>] [--text <text>] [--process <id>] [--black-box] [--members <id,...>] [key=value ...]', summary: 'Create one element and wire it in (see PLACEMENT and TRIGGERS). Pools: the first participant wraps the existing process, later ones get a new process; --black-box creates a pool without a process and never wraps, so add a normal pool first.', examples: ['bpmn add order.bpmn start "Order received"', 'bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived', 'bpmn add order.bpmn boundary:timer "2 days" --on Activity_CheckInvoice --timer PT2D --non-interrupting', 'bpmn add order.bpmn participant "Order handling"', 'bpmn add order.bpmn participant "Customer" --black-box'] },
  { name: 'connect', usage: 'bpmn connect <file> <sourceId> <targetId> [--name <text>] [--id <id>] [--condition <expr>] [--language <lang>] [--default] [--message <name>] [--if-absent]', summary: 'Connect two elements; sequence flow, message flow, association or data association is inferred from the endpoints.', examples: ["bpmn connect order.bpmn Gateway_InvoiceOk Activity_BookInvoice --name yes --condition '${ok}'", 'bpmn connect order.bpmn Activity_SendOffer Participant_Customer --message Offer'] },
  { name: 'set', usage: 'bpmn set <file> <id> <key=value ...> [--unset <key>]...', summary: 'Set properties (name, doc, condition, timer, loop, camunda:assignee, ...); key= or --unset removes.', examples: ['bpmn set order.bpmn Activity_CheckInvoice name="Check the invoice" camunda:assignee=kermit', 'bpmn set order.bpmn Flow_3 condition=\'${amount > 100}\'', 'bpmn set order.bpmn Activity_CheckInvoice --unset doc'] },
  { name: 'remove', usage: 'bpmn remove <file> <id...> [--no-bridge] [--if-exists]', summary: 'Remove elements with cascade; a node with one in / one out is bridged (predecessor -> successor) unless --no-bridge.', examples: ['bpmn remove order.bpmn Activity_Old', 'bpmn remove order.bpmn Event_Timeout Flow_7 --if-exists'] },
  { name: 'retype', usage: 'bpmn retype <file> <id> <kind[:trigger]> [trigger options]', summary: 'Change the kind (task <-> task/subProcess/callActivity, gateway <-> gateway, event <-> event of the same position, trigger changes) keeping id, name, flows and extensions. A kind without trigger suffix keeps the current trigger; <kind>:none (or `set <id> trigger=none`) drops it. Same trigger, new details: the event definition (id, vendor attributes) is kept. A sub-process with content becomes a task / callActivity only with --force (E_WOULD_DROP_CONTENT).', examples: ['bpmn retype order.bpmn Activity_CheckInvoice serviceTask', 'bpmn retype order.bpmn Event_Start startEvent:message --message OrderReceived', 'bpmn retype order.bpmn Event_Start startEvent:none'] },
  { name: 'move', usage: 'bpmn move <file> <id...> [--after <id>] [--before <id>] [--flow <flowId>] [--in <scopeId>] [--on <activityId>] [--lane <laneId>]', summary: 'Relocate nodes (they are detached with bridging, then placed again) and/or assign a lane.', examples: ['bpmn move order.bpmn Activity_Clarify --after Activity_CheckInvoice', 'bpmn move order.bpmn Activity_Book Activity_Ship --lane Lane_Backoffice'] },
  { name: 'order', usage: 'bpmn order <file> <nodeId> <flowId...> | bpmn order <file> <poolId|processId|laneId> <laneId...>', summary: 'Set the declaration order of a node\'s outgoing flows. In the diagram the default flow (else the first flow) continues straight and the others alternate below/above it in this order (see PLACEMENT). With lane ids: the lanes of a pool / process / parent lane top to bottom (laneSet and diagram bands).', examples: ['bpmn order order.bpmn Gateway_InvoiceOk Flow_yes Flow_no', 'bpmn order order.bpmn Participant_OrderHandling Lane_Backoffice Lane_Sales'] },
  { name: 'ext', usage: 'bpmn ext add <file> <id> <prefix:type> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace] | bpmn ext remove <file> <id> <type|index> | bpmn ext list <file> <id> [--json]', summary: 'Vendor extension elements inside <bpmn:extensionElements> (sub-command first, then file and element id).', examples: ['bpmn ext add order.bpmn Activity_BookInvoice zeebe:taskDefinition type=book-invoice retries=3', 'bpmn ext add order.bpmn Activity_BookInvoice zeebe:ioMapping --xml \'<zeebe:ioMapping><zeebe:input source="=amount" target="total"/></zeebe:ioMapping>\'', 'bpmn ext list order.bpmn Activity_BookInvoice', 'bpmn ext remove order.bpmn Activity_BookInvoice zeebe:taskDefinition'] },
  { name: 'apply', usage: 'bpmn apply <file> [<ops.json> | -]', summary: 'Run a list of ops (JSON) as one transaction: all or nothing, one layout at the end, then the format ops in batch order. `-` reads stdin.', examples: ['bpmn apply order.bpmn ops.json', "echo '[{\"op\":\"add\",\"kind\":\"userTask\",\"name\":\"Ship\",\"after\":\"Activity_BookInvoice\"}]' | bpmn apply order.bpmn -"] },
  { name: 'place', usage: 'bpmn place <file> <id...> [--row-of <id> | --below <id> | --above <id>] [--column-of <id> | --after <id> | --before <id>]', summary: 'Diagram only: move shapes as one rigid group so the first lands on the row and/or column of another element; boundary events and labels follow, others give way, flows are rerouted. Refuses to leave the lane / pool / sub-process (E_LEAVES_CONTAINER).', examples: ['bpmn place order.bpmn Activity_ClarifyInvoice Event_ReminderSent --below Activity_BookInvoice', 'bpmn place order.bpmn Event_InvoiceHandled --row-of Activity_CheckInvoice --after Gateway_InvoiceOk_join'] },
  { name: 'align', usage: 'bpmn align <file> <id...> --axis row|column [--to <id>]', summary: 'Diagram only: put shapes on one row (same vertical centre) or one column (same horizontal centre) as --to (default: the first id).', examples: ['bpmn align order.bpmn Event_InvoiceHandled Event_ReminderSent --axis column'] },
  { name: 'color', usage: `bpmn color <file> <id...> --color ${Object.keys(SWATCHES).join('|')}|default`, summary: 'Diagram only: colour shapes and connections with a bpmn-js colour picker colour; default removes it. Colours survive every later write.', examples: ['bpmn color order.bpmn Activity_CheckInvoice Flow_2 Gateway_InvoiceOk --color red'] },
  { name: 'label', usage: 'bpmn label <file> <id> --side above|below|left|right', summary: 'Diagram only: put the external label of an event, gateway, data object / store or flow on one side (flows: of their longest horizontal / vertical segment).', examples: ['bpmn label order.bpmn Gateway_InvoiceOk --side below'] },
  { name: 'route', usage: 'bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]', summary: 'Diagram only: route one sequence / message flow again, optionally forcing the side it leaves its source and enters its target by.', examples: ['bpmn route order.bpmn Flow_8 --exit bottom --entry bottom'] },
  { name: 'space', usage: 'bpmn space <file> (--after <id> | --below <id>) [--by column|row|<px>]', summary: 'Diagram only: the modeler\'s space tool: everything right of (--after, within the pool) or below (--below) the element moves by one column / row (default) or <px>; frames grow. On a lane or pool it makes that frame bigger.', examples: ['bpmn space order.bpmn --after Activity_CheckInvoice', 'bpmn space order.bpmn --below Lane_Sales --by 80'] },
  { name: 'tidy', usage: 'bpmn tidy <file> [<id>...]', summary: 'Diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order (default: every shape). Same as `bpmn layout <file> --tidy`.', examples: ['bpmn tidy order.bpmn'] },
  { name: 'validate', usage: 'bpmn validate <file> [--json] [--strict]', summary: 'Structural errors (an error a change introduces blocks its write) and lint warnings, without changing the file.', examples: ['bpmn validate order.bpmn --json'] },
  { name: 'layout', usage: 'bpmn layout <file> [--expand <id,...>] [--collapse <id,...>] | bpmn layout <file> --tidy', summary: 'Redraw the whole diagram (DI) from the model, optionally changing which sub-processes are expanded (always redraws, a hand layout is replaced; there is no --no-layout here). --tidy keeps the drawing and only removes overlaps (= bpmn tidy).', examples: ['bpmn layout order.bpmn --collapse Activity_Payment', 'bpmn layout order.bpmn --tidy'] },
  { name: 'metrics', usage: 'bpmn metrics <file> [--json]', summary: 'Layout quality of the drawing: the score and every problem (crossings, overlaps, flows through shapes, labels on lines, nodes outside their lane / pool, frames covering foreign shapes, ...) with the element ids.', examples: ['bpmn metrics order.bpmn --json'] },
  { name: 'kinds', usage: 'bpmn kinds [--json]', summary: 'Kind table, trigger options, set keys, placement grammar, ops schema and error catalogue.', examples: ['bpmn kinds', 'bpmn kinds --json'] },
  { name: 'guide', usage: 'bpmn guide', summary: 'This cheat sheet.', examples: ['bpmn guide'] },
];

export const COMMON_OPTIONS: Array<{ option: string; description: string }> = [
  { option: '--json', description: 'machine-readable result on stdout (errors as JSON on stderr)' },
  { option: '-o, --out <file>', description: 'write to another file instead of in place' },
  { option: '--dry-run', description: 'report what would change, write nothing' },
  { option: '--layout <mode>', description: `${LAYOUT_MODES.join(' | ')}: auto (default) keeps a hand-made or formatted drawing and places changes locally, and redraws a new file or a drawing the engine made and nobody changed; incremental always keeps; full always redraws (colours survive)` },
  { option: '--relayout', description: 'redraw the whole diagram (= --layout full)' },
  { option: '--no-layout', description: 'write without updating the diagram (stale DI of removed elements is pruned, new elements have no shape until `bpmn layout`; format operations still apply to the existing drawing)' },
  { option: '--force', description: 'write although the import was lossy (E_IMPORT_LOSSY), the change introduces validation errors (E_VALIDATION; errors the file already had never block) or a retype would delete a sub-process\'s content (E_WOULD_DROP_CONTENT); for `new`: overwrite an existing file' },
  { option: '--backup', description: 'write <file>.bak before overwriting' },
  { option: '--show', description: 'append the full model view to the result' },
  { option: '--strict', description: 'exit 5 when the result has warnings' },
  { option: '--engine <clean|auto>', description: 'layout engine: clean (built-in, default: straight happy path, branches as bands below, loops underneath) or auto (bpmn-auto-layout)' },
];

/* ------------------------------------------------------------------ */
/* text helpers                                                         */
/* ------------------------------------------------------------------ */

const FAMILY_LABELS: Record<Family, string> = {
  task: 'Tasks',
  subProcess: 'Sub-processes',
  callActivity: 'Call activity',
  gateway: 'Gateways',
  event: 'Events  (kind:trigger, e.g. startEvent:message, boundary:timer)',
  participant: 'Pools',
  lane: 'Lanes',
  data: 'Data',
  artifact: 'Artifacts',
};

/** Left-aligned columns separated by two spaces; the last column is not padded. */
export function table(rows: string[][], indent = '  '): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows
    .map((row) => indent + row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ').trimEnd())
    .join('\n');
}

function heading(title: string): string {
  return `\n${title}\n${'-'.repeat(title.length)}`;
}

function kindLabelWithAliases(def: KindDef): string {
  return def.aliases.length ? `${def.kind} (${def.aliases.join(', ')})` : def.kind;
}

function kindsSection(): string {
  const out: string[] = [heading('KINDS  (bpmn add <file> <kind[:trigger]> [name] ...; aliases in parentheses; id prefix in the 2nd column)')];
  const families = [...new Set(KINDS.map((k) => k.family))];
  for (const family of families) {
    out.push(`\n${FAMILY_LABELS[family]}`);
    const rows: string[][] = [];
    for (const def of KINDS.filter((k) => k.family === family)) {
      rows.push([kindLabelWithAliases(def), `${def.prefix}_`, def.description]);
      if (def.triggers) rows.push(['', '', `triggers: ${def.triggers.join(', ')}`]);
    }
    out.push(table(rows));
  }
  return out.join('\n');
}

function triggersSection(): string {
  const rows = TRIGGER_OPTIONS.map((t) => [t.trigger, t.option, t.description, `on: ${kindsWithTrigger(t.trigger).join(', ') || '-'}`]);
  return [heading('TRIGGERS  (event kind suffix + option; ops JSON keys = option names in lowerCamelCase)'), table(rows), `  ${NON_INTERRUPTING_DOC}`].join('\n');
}

function groupSetKeys(keys: SetKeyDoc[]): Map<string, SetKeyDoc[]> {
  const groups = new Map<string, SetKeyDoc[]>();
  for (const k of keys) {
    const list = groups.get(k.appliesTo) ?? [];
    list.push(k);
    groups.set(k.appliesTo, list);
  }
  return groups;
}

function setKeysSection(): string {
  const out: string[] = [heading('SET KEYS  (bpmn set <file> <id> key=value ...; key= or --unset key removes; also usable as `set` in add ops)')];
  if (!SET_KEYS.length) {
    out.push('  (no set keys registered)');
    return out.join('\n');
  }
  for (const [appliesTo, keys] of groupSetKeys(SET_KEYS)) {
    out.push(`\n${appliesTo}`);
    out.push(table(keys.map((k) => [k.key, k.description])));
  }
  return out.join('\n');
}

function placementSection(): string {
  return [heading('PLACEMENT  (add / move; ops JSON key in parentheses)'), table(PLACEMENT_DOCS.map((p) => [p.option, `(${p.key})`, p.rule])), ...PLACEMENT_NOTES.map((n) => `  ${n}`)].join('\n');
}

function errorsSection(): string {
  const out: string[] = [heading('ERRORS AND WARNINGS')];
  for (const e of ERROR_CATALOGUE) out.push(`  ${e.code}\n      ${e.meaning}\n      fix: ${e.fix}`);
  return out.join('\n');
}

function exitCodesSection(): string {
  return [heading('EXIT CODES'), table(EXIT_CODE_DOCS.map((e) => [String(e.code), e.meaning]))].join('\n');
}

function opsSection(): string {
  const out: string[] = [heading('OPS JSON  (bpmn apply <file> ops.json; keys = CLI flags in lowerCamelCase; full schema: bpmn kinds --json -> ops)')];
  for (const n of OP_NAMES) {
    const required = Object.entries(OP_FIELDS[n]).filter(([, s]) => s.required).map(([k]) => k);
    out.push(`  ${n.padEnd(8)} ${OP_DESCRIPTIONS[n]}`);
    out.push(`           keys: ${Object.keys(OP_FIELDS[n]).join(', ')}${required.length ? `  (required: ${required.join(', ')})` : ''}`);
  }
  out.push('\nExample (after `bpmn new order.bpmn --name "Order handling" --target camunda8`, start -> "Check invoice" -> end):');
  out.push(JSON.stringify(opsExample(), null, 2));
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* public renderers                                                     */
/* ------------------------------------------------------------------ */

/** `bpmn kinds`: kinds, triggers, set keys, placement grammar and the error catalogue as text. */
export function kindsText(): string {
  return [kindsSection(), triggersSection(), setKeysSection(), placementSection(), errorsSection()].join('\n') + '\n';
}

/** `bpmn kinds --json`: the same as one object, plus the ops schema and example. */
export function kindsJson(): Record<string, unknown> {
  return {
    kinds: KINDS.map((k) => ({
      kind: k.kind,
      type: k.type,
      family: k.family,
      aliases: k.aliases,
      prefix: k.prefix,
      ...(k.triggers ? { triggers: k.triggers } : {}),
      ...(k.props ? { props: k.props } : {}),
      description: k.description,
    })),
    triggers: Object.fromEntries(
      TRIGGER_OPTIONS.map((t) => [
        t.trigger,
        {
          ...(t.trigger !== 'none' ? { type: TRIGGER_TYPES[t.trigger] } : {}),
          option: t.option,
          keys: t.keys,
          description: t.description,
          kinds: kindsWithTrigger(t.trigger),
        },
      ]),
    ),
    nonInterrupting: NON_INTERRUPTING_DOC,
    setKeys: SET_KEYS,
    placement: {
      options: PLACEMENT_DOCS,
      notes: PLACEMENT_NOTES,
    },
    ops: OPS_SCHEMA,
    opsExample: opsExample(),
    layoutModes: [...LAYOUT_MODES],
    colors: SWATCHES,
    errors: ERROR_CATALOGUE,
    exitCodes: Object.fromEntries(EXIT_CODE_DOCS.map((e) => [String(e.code), e.meaning])),
  };
}

/** `bpmn guide`: the agent cheat sheet. */
export function guideText(): string {
  const out: string[] = [];
  out.push('bpmn — edit BPMN 2.0 models semantically; the diagram is drawn for you');
  out.push('======================================================================');
  out.push(heading('CONTRACT'));
  out.push(
    [
      '  - You edit the metamodel: kinds, names, flows, triggers, lanes, pools, properties, extensions.',
      '  - You never see or write DI (shapes, edges, coordinates). The CLI keeps the drawing: a hand-made (or formatted)',
      '    diagram stays as it is, new elements are placed locally and only affected flows rerouted; a new file, or a',
      '    drawing the engine made and nobody changed, is redrawn by the built-in engine (see LAYOUT MODES).',
      '  - To change the picture, use the format commands (place, align, color, label, route, space, tidy, order of',
      '    lanes); they name other elements, never coordinates (see FORMATTING WITHOUT XML).',
      '  - Ids are readable and stable: <Prefix>_<NameSlug> (Activity_CheckInvoice, Gateway_InvoiceOk, Flow_3).',
      '    Every result names the ids it created; use them in the next command.',
      '  - Sub-processes are drawn expanded by default (`--collapsed` / `set expanded=false` to collapse).',
      '  - Branches: the default flow (else the first outgoing flow) continues straight; the other branches alternate',
      '    below and above it in declaration order (`bpmn order` changes the order, `set <flowId> default=true` the continuation).',
      '  - One diagram root: the collaboration when pools exist, else the single process. Several root processes',
      '    need pools (participants). Complex gateways are not supported (a file with one stays editable;',
      '    retype it to a supported gateway). Errors a file already has never block a write (W_PREEXISTING_ERROR).',
    ].join('\n'),
  );
  out.push(heading('WORKFLOW'));
  out.push(
    [
      '  1. bpmn new <file> --name "..."          create (or start from an existing .bpmn)',
      '  2. bpmn show <file>                       read the model in flow order; note the ids',
      '  3. bpmn add / connect / set / remove ...  one change per command, or many in one `bpmn apply <file> ops.json`',
      '                                            (the split macro is an apply-only op; there is no split command)',
      '  4. bpmn validate <file>                   new errors block a write anyway; warnings are lint hints',
      '  5. bpmn show <file>                       confirm the result (add --show to any mutating command instead)',
      '  Prefer `apply` for more than two related changes: it is one transaction and one layout pass.',
    ].join('\n'),
  );
  out.push(heading('LAYOUT MODES  (every mutating command: --layout <auto|incremental|full>, --relayout, --no-layout)'));
  out.push(
    [
      '  auto (default)  no diagram yet, or the drawing is exactly what the engine would draw (nobody changed it):',
      '                  redraw in full. Otherwise keep it: new elements are placed next to their neighbours, room is',
      '                  made like the modeler\'s space tool, only affected flows are rerouted, removed elements\' DI pruned.',
      '  incremental     always keep the drawing (fails with E_LAYOUT_INCREMENTAL instead of redrawing).',
      '  full            always redraw (= --relayout; also `bpmn layout <file>`). Colours survive, positions do not.',
      '  The result says which mode ran and why, what was placed / moved / rerouted, and the layout quality before ->',
      '  after with the problems added and resolved (ids). A format command that changed the drawing (moved a shape,',
      '  rerouted a flow, moved a label) makes it hand-made, so later writes keep your formatting.',
    ].join('\n'),
  );
  out.push(heading('FORMATTING WITHOUT XML  (diagram only: the model does not change)'));
  out.push(
    [
      '  1. bpmn show <file> --layout       per pool / lane the rows of node ids (left to right), colours, label sides,',
      '                                     and the layout problems with ids',
      '  2. place / align / space / route / label / color / order (lanes) / tidy: say where things go by naming',
      '     other elements; others give way, frames grow, flows are rerouted',
      '  3. bpmn metrics <file>             check that no overlaps / through / outsideLane / frameIntrusion were added',
      '  Recipes:',
      '    bpmn color f.bpmn Activity_A Flow_3 Activity_B --color red          a path in red (default removes)',
      '    bpmn align f.bpmn Event_Done Event_Rejected --axis column           end events in one column',
      '    bpmn place f.bpmn Activity_Fix Event_Fixed --below Activity_Book    a branch one row below (rigid group)',
      '    bpmn place f.bpmn Event_Done --row-of Activity_Check                same row, x unchanged',
      '    bpmn order f.bpmn Participant_Org Lane_Boss Lane_Clerk              lanes top to bottom',
      '    bpmn route f.bpmn Flow_Retry --exit bottom --entry bottom           a loop below',
      '    bpmn space f.bpmn --after Activity_Check                            room for one more column',
      '    bpmn label f.bpmn Gateway_Ok --side below',
      '    bpmn tidy f.bpmn                                                    remove overlaps (= layout --tidy)',
      '  In `apply` they are ops as well ({"op": "place", "ids": [...], "below": "..."}): they run after the semantic',
      '  ops and the layout, in batch order, all or nothing. A node cannot be placed out of its lane: `move --lane` first',
      '  (E_LEAVES_CONTAINER). No room next to the reference (E_NO_ROOM): `space --after/--below <id>` first.',
    ].join('\n'),
  );
  out.push(heading('QUOTING'));
  out.push(
    [
      "  - Expressions and anything with `$`: single quotes, e.g. --condition '${amount > 100}'.",
      '  - Names with spaces: quote them, e.g. add userTask "Check invoice".',
      '  - key=value with spaces: quote the whole pair, e.g. name="Check the invoice".',
      '  - In JSON nothing is expanded, so ops files are the safest place for expressions.',
    ].join('\n'),
  );
  out.push(heading('COMMANDS'));
  for (const c of COMMANDS) {
    out.push(`\n  ${c.usage}`);
    out.push(`      ${c.summary}`);
    for (const ex of c.examples) out.push(`      $ ${ex}`);
  }
  out.push('\n  Common options of every mutating command:');
  out.push(table(COMMON_OPTIONS.map((o) => [o.option, o.description]), '      '));
  out.push('\n  Result (text): one line per created/changed/removed element, then notes, warnings, then');
  out.push('  "layout: ok - <full|incremental> (<reason>)" or "layout: skipped", the ids the layout placed / moved / rerouted /');
  out.push('  pruned, one "format <op> #<index>: moved ...; rerouted ...; colored ..." line per format op, "layout quality:');
  out.push('  score <before> -> <after>; added: <kind> [ids]; resolved: ...", then "written: <file>" ("dry run: <file> not written").');
  out.push('  With --json: {ok, file, written, created, changed, removed, warnings, notes, layout: {status, mode, reason,');
  out.push('  warnings, expanded, placed?, moved?, rerouted?, pruned?, notes?, format?: [{op, index, moved, rerouted, colored?,');
  out.push('  labels?, notes?}], metrics: {before?, after: {counts, score}, added, resolved}}, validation: {errors, warnings},');
  out.push('  importWarnings, view?}.');
  out.push('  Errors go to stderr as "error E_CODE: message" + "  hint: ..." (+ candidates); with --json as');
  out.push('  {ok: false, error: {code, message, element?, related?, candidates?, hint?, op?}}.');
  out.push(placementSection());
  out.push(triggersSection());
  out.push(opsSection());
  out.push(exitCodesSection());
  out.push(heading('COMMON ERRORS'));
  const common = ['E_NOT_FOUND', 'E_HAS_SUCCESSOR', 'E_AMBIGUOUS_SCOPE', 'E_CROSS_SCOPE', 'E_INVALID_PLACEMENT', 'E_TRIGGER_REQUIRED', 'E_UNKNOWN_KEY', 'E_VALIDATION', 'E_IMPORT_LOSSY', 'E_USAGE', 'E_LEAVES_CONTAINER', 'E_NO_ROOM'];
  for (const code of common) {
    const e = ERROR_CATALOGUE.find((d) => d.code === code);
    if (e) out.push(`  ${e.code}: ${e.meaning}\n      fix: ${e.fix}`);
  }
  out.push('  The full catalogue: `bpmn kinds` (section ERRORS AND WARNINGS) or `bpmn kinds --json` -> errors.');
  return out.join('\n') + '\n';
}

/**
 * Self-description for agents: `bpmn kinds [--section <names>]`, `bpmn kinds
 * --json`, `bpmn guide` (everything), `bpmn guide --short` (the core in at
 * most 5 KB) and `bpmn guide <topic>` (one section of the full guide).
 *
 * Everything here is derived from the live tables (KINDS, SET_KEYS, the ops
 * field specs and schema) so the text can never drift from the code; only
 * the error catalogue, exit codes, trigger options, placement rules and the
 * command reference are written by hand.
 */
import { EXIT_CODES, usageError } from './errors.js';
import { KINDS, TRIGGER_TYPES, type Family, type KindDef, type Trigger } from './kinds.js';
import { Doc } from './document.js';
import { NESTED_SLOTS, NESTED_TYPES, nestedKeysOf, SET_KEYS, type NestedSlot, type SetKeyDoc } from './ops/set.js';
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
  { code: 'E_IMPORT_LOSSY', meaning: 'bpmn-moddle dropped content while importing (unparsable/unknown elements, unresolved references, duplicate ids, an element the schema allows once appearing twice: "duplicate element", e.g. two loopCharacteristics; the reader keeps the last one); writing would lose it. The library refuses it too (Doc.fromXml + mutateDoc). `show` and `validate` print these as `import:` lines (`validate --strict` exits 5 on them).', fix: 'Inspect the warnings with `bpmn validate <file>`, fix the XML, or write anyway with --force (library: force: true; the reported content is dropped, of a duplicate element the last one is kept).' },
  { code: 'E_NO_FILE', meaning: 'No output file: the document was not loaded from a file and no -o/--out was given.', fix: 'Pass -o <file>.' },
  { code: 'E_FILE_EXISTS', meaning: '`bpmn new` refuses to overwrite an existing file.', fix: 'Choose another name, or pass --force to overwrite.' },
  { code: 'E_INVALID_XML', meaning: 'The --xml snippet of `ext add` could not be parsed.', fix: 'Pass one well-formed element with declared prefixes, e.g. --xml \'<zeebe:taskDefinition type="x"/>\', or use <prefix:type> attr=value instead.' },
  // ids & lookup
  { code: 'E_NOT_FOUND', meaning: 'No element with the given id. Ids of vendor extension elements (e.g. camunda:formField) are not element ids: the message then names the BPMN element they belong to.', fix: 'Use the candidates listed, or run `bpmn show <file>` / `bpmn find <file> <text>` to list ids. `remove --if-exists` / `add --if-absent` make the op idempotent.' },
  { code: 'E_WRONG_KIND', meaning: 'The element exists but is not of the expected kind (e.g. a flow where a node is required); also `ext add` on bpmn:definitions or a non-BPMN element (the BPMN 2.0 XSD has no extensionElements there; the engines refuse the file), or a definition. / loop. / condition. prefix the element has no slot for.', fix: 'Pass an id of the right kind; `bpmn show <file> <id>` prints the kind. Process-level extensions go on the process id.' },
  { code: 'E_INVALID_ID', meaning: 'The id is not an XML NCName ([A-Za-z_][A-Za-z0-9_.-]*).', fix: 'Use letters, digits, _ . - and start with a letter or _, e.g. Activity_CheckInvoice.' },
  { code: 'E_DUPLICATE_ID', meaning: 'An element with that id already exists (BPMN and diagram elements only: ids inside vendor extension elements, e.g. two camunda:formField with the same id in different forms, are not checked).', fix: 'Choose another --id, omit it (ids are generated from the name), or use --if-absent.' },
  { code: 'E_UNKNOWN_KIND', meaning: 'The kind token is not a known kind, alias or bpmn type.', fix: 'Run `bpmn kinds`; the message suggests close matches.' },
  { code: 'E_UNSUPPORTED_KIND', meaning: 'The kind exists in BPMN but is not supported (complexGateway, choreographies, groups).', fix: 'Model it differently, e.g. exclusiveGateway/inclusiveGateway instead of complexGateway.' },
  { code: 'E_UNKNOWN_KEY', meaning: '`set` got a key that is not settable on this element; also a bad nested selector (`definition[x].`) or a selector on loop. / condition.', fix: 'The message lists the settable keys; `bpmn kinds` has the full set-key table. Vendor attributes need a prefix (camunda:assignee). An attribute without prefix that BPMN does not define (W_C7_DEPLOY_SCHEMA) can only be removed: `bpmn set <file> <id> <attr>=`.' },
  { code: 'E_INVALID_VALUE', meaning: 'A value is not acceptable: empty condition, bad enum value, option on the wrong connection kind, ...; also removing `condition.camunda:resource` from a condition without inline body (it would leave an empty condition, which every engine evaluation fails on).', fix: 'Quote expressions with single quotes (\'${ok}\'), check the allowed values in the message. A script resource is replaced in one command: `bpmn set <file> <id> condition.camunda:resource= \'condition=${...}\'` (flow; or `condition=` to remove the condition) / `\'when=${...}\'` (conditional event).' },
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
  { code: 'E_CROSS_SCOPE', meaning: 'A sequence flow would cross a process / sub-process / pool boundary; or `definition.activityRef` names an activity outside the compensation event\'s scope (allowed: its own (sub-)process, from an event sub-process also the scope around it; the engines refuse anything else).', fix: 'Use a message flow between pools (`connect` infers it), or move the node with `bpmn move <id> --in <scope>`. For activityRef pick one of the listed candidates, or `definition.activityRef=` to compensate the whole scope.' },
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
  { code: 'E_INVALID_HOST', meaning: 'A boundary event is attached to a non-activity, to an activity in another scope, or to a compensation handler (isForCompensation=true; `add --on` / `move --on` refuse it, and `set isForCompensation=true` on an activity with boundary events is blocked; the C7 engines reject such a file).', fix: 'Attach it to a task/sub-process of the same scope that is not a compensation handler (`--on <activityId>`), move it with `bpmn move <id> --in <scope>`, or `bpmn set <file> <hostId> isForCompensation=false`.' },
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
  { code: 'E_NO_EXTENSION', meaning: '`ext remove`: the element (or the nested element named by a definition. / loop. / condition. prefix) has no extension elements, none matching the selector, or the index is out of range; `ext add`: a path step does not exist and cannot be created (only attribute-free containers are created on the way).', fix: 'Run `bpmn ext list <file> <id>` and remove by an existing type, selector (the candidates list keyed items such as camunda:inputParameter[name=a]) or index; create the parent first (a listener or form field) and select it with [attr=value] or [n].' },
  { code: 'W_BLACK_BOX', meaning: '`remove`: a participant lost its process and is now a black-box pool.', fix: 'Remove the participant too, or bind a new process to it.' },
  { code: 'W_DANGLING_CALLED_ELEMENT', meaning: '`remove`: a call activity still references the removed process id via calledElement.', fix: '`bpmn set <file> <callActivityId> calledElement=<processId>` or remove the call activity.' },
  { code: 'W_FLOW_DROPPED', meaning: '`move`: a sequence flow was removed because it would cross scopes after the move (also for boundary events that followed their host).', fix: 'Reconnect the node inside its new scope with `bpmn connect`.' },
  { code: 'E_WOULD_DROP_CONTENT', meaning: '`retype` to a kind that cannot hold the element\'s content (a sub-process with nodes -> task / callActivity) would delete that content; nothing was written. The ids are listed.', fix: 'Move what should stay out first (`bpmn move <file> <ids> --in <scopeId>`), or pass --force to retype anyway (the listed elements are deleted).' },
  { code: 'E_INVALID_RETYPE', meaning: '`retype` between incompatible families (e.g. task -> gateway, start -> end event).', fix: 'Retype within a family (task <-> task/subProcess/callActivity, gateway <-> gateway, event <-> event of the same position); otherwise remove and add.' },
  // write-time
  { code: 'E_VALIDATION', meaning: 'The change would introduce structural errors, or errors of a validator (the design profile, `[design] E_DESIGN_*`; a host\'s validator in library use), so the file was not written (the new errors are listed in the details, a validator\'s with its name in brackets; errors the file already had do not block, see W_PREEXISTING_ERROR). Validators check the result after the layout, i.e. exactly what would be written.', fix: 'Run `bpmn validate <file>` and fix the listed problems (every finding has its own code and hint), make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway. `--profile none` switches the design profile off.' },
  { code: 'E_VALIDATOR_FAILED', meaning: 'A validator (MutationOptions.validators / checkFile validators in library use) threw or did not return an array of findings; nothing was written.', fix: 'Fix the validator or the input it cannot read, or run without it.' },
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
  { code: 'W_EVENT_GATEWAY_TARGET', meaning: 'An event-based gateway leads to something BPMN 2.0 does not allow there: not a catching event or receive task (lint); in a plain file also a receive task mixed with message catch events, a receive task with boundary events, or a target with another incoming flow (`connect`, `add`, `move` warn about the edge they create). Camunda 7, CIB seven and Operaton accept only intermediate catch events: in a Camunda 7 file W_C7_DEPLOY_EVENT_GATEWAY reports it instead.', fix: 'Put intermediateCatchEvent:<message|timer|signal|conditional> nodes directly after the gateway (`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow <flowId> --message <Msg>`).' },
  { code: 'W_EMPTY_SUBPROCESS', meaning: 'A sub-process contains no nodes.', fix: '`bpmn add <file> startEvent --in <subProcessId>` and build its content, or remove it.' },
  { code: 'W_DUPLICATE_NAME', meaning: 'Several elements of the same kind share a name.', fix: 'Rename with `bpmn set <file> <id> name=...` unless intended.' },
  { code: 'W_IMPLICIT_SPLIT', meaning: 'A non-gateway node got a second outgoing flow (implicit parallel split).', fix: 'Route the branches through a gateway: a `split` op in `bpmn apply` (split exists only as an apply op, not as a command) or `bpmn add <file> exclusiveGateway --after <id>` plus `connect`; ignore it when the implicit split is intended.' },
  { code: 'W_IMPLICIT_JOIN', meaning: 'A non-gateway node got a second incoming flow (implicit join: every token runs the node again).', fix: 'Join through a gateway unless the repeated execution is intended.' },
  { code: 'W_LABEL_DROPPED', meaning: 'While bridging a removed node the outgoing flow label could not be carried over because the incoming flow has its own.', fix: 'Set the wanted label on the surviving flow with `bpmn set <file> <flowId> name=...`.' },
  { code: 'W_CONDITION_DROPPED', meaning: 'While bridging a removed node the outgoing flow condition could not be carried over.', fix: 'Set the condition on the surviving flow with `bpmn set <file> <flowId> condition=...`.' },
  { code: 'W_PROPERTY_DROPPED', meaning: '`retype` dropped a property the new kind does not have (e.g. script on a userTask); a trigger kind change (`set trigger=`, `retype`) dropped vendor attributes / extension elements of the old event definition (changing only the details of the same trigger keeps the definition; on an event with several definitions `set trigger=<t>` keeps that one and drops the others); `set loop=none|standard` (or standard -> multi-instance) dropped the vendor content of the old loop; a condition change dropped camunda:resource / the script language (an inline body replacing a script resource, a ${...} body that does not inherit a script language) or the inline body (a script resource replacing it); or `ext add` replaced a keyed item (same name / id) whose attributes, value or children the new one does not have.', fix: 'Re-add the information in a form the new kind supports (the hint says how, e.g. language=<lang> to keep a script language; for `ext add` the hint holds the `--xml` that keeps the old content), or accept the loss.' },
  { code: 'W_PREEXISTING_ERROR', meaning: 'A structural error, or an error of a validator (the design profile: `[design]`), that the model already had before this change (the message starts with its original code); it does not block the write. A validator\'s error follows its element through a rename. A result counts it with the other warnings the file already had (`N warnings already in the file`, JSON `warnings.preexistingCount`) instead of listing it; `MutationResult.validation.warnings` of the library keeps it.', fix: 'Fix it when convenient: `bpmn validate <file>` lists it with its own code and hint.' },
  // vendor content: nested keys of set, ext structure, retype, connect, remove
  { code: 'E_WRONG_HOST', meaning: '`set`: a known camunda attribute was given to an element that does not carry it: the Camunda descriptor places it on a nested element (the event definition, the multi-instance loop or the condition expression), it is a process attribute given to a participant, or a `<slot>.<attr>` the nested element cannot carry (loop.camunda:collection on a standard loop).', fix: 'Use the prefixed key from the hint, e.g. `bpmn set <file> <id> definition.camunda:errorCodeVariable=code`, `bpmn set <file> <id> \'loop.camunda:collection=${items}\'`, `bpmn set <file> <flowId> condition.camunda:resource=<uri>`; set the trigger it needs first (trigger=error ...), loop=parallel for multi-instance attributes, or set it on the process id.' },
  { code: 'E_NO_NESTED_ELEMENT', meaning: '`set`: a definition. or condition. key names a nested element that does not exist (an event without trigger has no event definition; a flow or conditional event without condition has no condition expression), or a `definition[<n>]` / `definition[<trigger>]` selector matches no event definition.', fix: 'Give the event a trigger in the same command (`bpmn set <file> <id> trigger=<t> definition.<key>=<value>`) or set condition=<expr> / when=<expr> first; a script resource condition is created directly with `condition.camunda:resource=<uri> language=<lang>`. (loop. never needs this: a parallel multi-instance loop is created.)' },
  { code: 'E_AMBIGUOUS_NESTED', meaning: '`set` / `ext` with `definition.` on an event that has several event definitions: it does not say which one. The message lists them as definition[<n>] = <type> <id>.', fix: 'Name one by position (0-based) or by trigger: `bpmn set <file> <id> \'definition[1].<key>=<value>\'` or `\'definition[timer].<key>=<value>\'` (quote the brackets in a shell; `ext` takes the same prefix), or keep a single definition: `bpmn set <file> <id> trigger=<t>` (the engines act on one only, see W_C7_MULTIPLE_EVENT_DEFINITIONS).' },
  { code: 'E_DUPLICATE_EXTENSION', meaning: '`ext add` would create a second single-instance vendor element (camunda:inputOutput, formData, connector, failedJobRetryTimeCycle, properties; nested: connector/connectorId, formField/validation, ...; zeebe:ioMapping, taskDefinition, ...) and merging is ambiguous: an attribute or value conflicts, or the element already holds several. Camunda 7 engines refuse duplicates (ENGINE-01009).', fix: 'Pass --replace to replace it as a whole, or remove the old one first (`bpmn ext remove <file> <id> <selector>`, see `bpmn ext list <file> <id>`).' },
  { code: 'E_AMBIGUOUS_EXTENSION', meaning: 'An `ext add` path step matches several vendor elements, or an `ext remove` predicate matches items in several places.', fix: 'Name one with [attr=value] or [index] in the path, e.g. \'camunda:formField[id=amount]/camunda:validation\'; the error lists the candidate paths.' },
  { code: 'E_INVALID_BRIDGE', meaning: '`remove` (or `move`) would bridge an event-based gateway to a target the file\'s rule does not allow. Camunda 7 files: the engines\' rule (only message / timer / signal / conditional intermediate catch events, no receive tasks, no catch event with another incoming flow, no two branches waiting for one message or signal name). Other files: BPMN 2.0 (catch events with those triggers or receive tasks without boundary events, receive tasks not mixed with message catch events, no other incoming flow). The message says which rule applied.', fix: '`bpmn remove <file> <id> --no-bridge` and wire the gateway yourself, put a catch event in front of the successor first (`bpmn add <file> intermediateCatchEvent:timer "<Name>" --flow <flowId> --timer PT1H`), or remove the successor in the same command. For move: move a whole branch, or remove and re-add.' },
  { code: 'W_MISPLACED_EXTENSION', meaning: '`ext add`: camunda content was added at the top of extensionElements where the engines do not read it: a type that may only be nested and has no unique container (camunda:constraint, validation, value, script, entry, list, map), or camunda:field on an element that does not read fields.', fix: 'Add it with a path into its container (the hint shows one, e.g. \'camunda:formField[id=<id>]/camunda:validation/camunda:constraint\') and remove the loose one (`bpmn ext remove <file> <id> <index>`).' },
  { code: 'W_DUPLICATE_FLOW', meaning: '`connect` created a second sequence or message flow between the same two elements (the target runs twice).', fix: 'Use --if-absent to skip an existing connection, or remove the extra flow with `bpmn remove <file> <flowId>`.' },
  { code: 'W_PROPERTY_INAPPLICABLE', meaning: '`retype`: camunda attributes or extension elements of the element are not allowed on the new kind by the Camunda descriptor (camunda:assignee on a serviceTask, camunda:topic on a userTask, camunda:taskListener outside a userTask). They are kept (nothing was dropped) but have no effect.', fix: 'Remove them with the commands in the hint (`bpmn set <file> <id> camunda:assignee=`, `bpmn ext remove <file> <id> camunda:taskListener`), set what the new kind needs, or retype back.' },
  // platform profile (validate, and the findings a mutation introduces)
  { code: 'W_C7_*', meaning: 'A finding of the Camunda 7 profile, which runs in Camunda 7 files (detected from modeler:executionPlatform or the camunda namespace; CIB seven and Operaton included; `validate --platform c7|c8|none|auto`). A file that uses Operaton\'s own namespace (operaton:*) is read the way Operaton reads it: operaton:* first, camunda:* as the fallback (Camunda 7 and CIB seven ignore operaton:*); `--json` platform says `"operaton": true` and the detail line says so. Every finding has a severity (JSON field `severity`): deploy = the engines (Camunda 7.24, CIB seven 2.2, Operaton 2.1) refuse the file (codes W_C7_DEPLOY_*); runtime = it deploys but the setting is ignored or fails when it runs; practice = it works, the engine logs a warning. Only executable processes are checked, without the content of ad-hoc sub-processes (the engines skip both); the schema rules cover the whole file (W_C7_DEPLOY_SCHEMA, and the event definitions of W_C7_DEPLOY_EVENT_DEFINITION / W_C7_DEPLOY_LINK). A mutation reports only the findings it introduced.', fix: 'Fix every W_C7_DEPLOY_* finding before deploying; the hint of each finding names the exact `bpmn set` / `bpmn ext` / `bpmn add|remove|move` command. `bpmn validate <file>` lists all of them.' },
  { code: 'W_C7_DEPLOY_HISTORY_TTL', meaning: 'An executable process has no camunda:historyTimeToLive, or a value that is not a number of days or P<n>D; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018).', fix: '`bpmn set <file> <processId> camunda:historyTimeToLive=180` (`bpmn new --target camunda7` writes 180).' },
  { code: 'W_C7_DEPLOY_IMPLEMENTATION', meaning: 'A service, send or business rule task (or a message throw / end event definition) has no implementation (class, delegateExpression, expression, type=external or shell, connector; decisionRef for business rule tasks), camunda:type is neither external nor shell ("mail" included: the standard distributions cannot load it), or a shell task has no camunda:field command, an expression field, or wait / redirectError / cleanEnv other than true / false; the engines refuse the file.', fix: '`bpmn set <file> <id> camunda:type=external camunda:topic=<topic>` (or camunda:delegateExpression=${...}; `definition.camunda:...` for message events); a shell task: `bpmn ext add <file> <id> camunda:field name=command stringValue=<command>`.' },
  { code: 'W_C7_DEPLOY_EXTERNAL_TOPIC', meaning: 'camunda:type=external without camunda:topic; the engines refuse the file.', fix: '`bpmn set <file> <id> camunda:topic=<topic>`.' },
  { code: 'W_C7_DEPLOY_RESULT_VARIABLE', meaning: 'camunda:resultVariable together with camunda:class or camunda:delegateExpression; the engines refuse the file.', fix: '`bpmn set <file> <id> camunda:resultVariable=`, or use camunda:expression.' },
  { code: 'W_C7_DEPLOY_CALLED_ELEMENT', meaning: 'A call activity has neither calledElement nor camunda:caseRef, or both; the engines refuse the file.', fix: '`bpmn set <file> <id> calledElement=<processId>` (or `camunda:caseRef=` to drop the case reference).' },
  { code: 'W_C7_DEPLOY_BINDING_VERSION', meaning: 'calledElementBinding / caseBinding / decisionRefBinding / formRefBinding is version (or versionTag) without the matching *Version / *VersionTag; the engines refuse the file.', fix: '`bpmn set <file> <id> camunda:<x>Version=<n>`, or set the binding to latest.' },
  { code: 'W_C7_DEPLOY_FORM', meaning: 'camunda:formRef without a formRefBinding of deployment / latest / version, or formKey and formRef together; the engines refuse the file.', fix: '`bpmn set <file> <id> camunda:formRefBinding=latest` or `bpmn set <file> <id> camunda:formKey=`.' },
  { code: 'W_C7_DEPLOY_BAD_VALUE', meaning: 'A value the engines refuse at deploy: mapDecisionResult not singleEntry / singleResult / collectEntries / resultList; jobPriority or (process / external) taskPriority not an integer or expression.', fix: '`bpmn set <file> <id> camunda:mapDecisionResult=singleEntry` or `bpmn set <file> <id> camunda:jobPriority=50`.' },
  { code: 'W_C7_DEPLOY_MULTI_INSTANCE', meaning: 'A multi-instance activity has neither loop cardinality nor camunda:collection (also when the collection sits on the activity instead of the loop), an empty cardinality, or an elementVariable without collection; the engines refuse the file.', fix: '`bpmn set <file> <id> \'loop.camunda:collection=${items}\' loop.camunda:elementVariable=item` (or cardinality=3).' },
  { code: 'W_C7_DEPLOY_DUPLICATE_EXTENSION', meaning: 'A second camunda:inputOutput / connector / connectorId / formData / failedJobRetryTimeCycle where the engine reads it; the engines refuse the file (ENGINE-01009).', fix: 'Merge them into one: `bpmn ext list <file> <id> --json`, then `bpmn ext add <file> <id> camunda:<type> --replace --xml \'...\'`.' },
  { code: 'W_C7_DEPLOY_INPUT_OUTPUT', meaning: 'camunda:inputOutput on a start or boundary event, a gateway or an event sub-process, or output parameters on an end event or a multi-instance activity; the engines refuse the file.', fix: '`bpmn ext remove <file> <id> camunda:inputOutput` (move the mapping to the next activity).' },
  { code: 'W_C7_DEPLOY_LISTENER', meaning: 'An execution or task listener without implementation (class / expression / delegateExpression / script) or event, with an event the engine does not know, a script without scriptFormat, or a timeout task listener without timer or without id; the engines refuse the file.', fix: 'Rebuild just that listener (the hint has both commands; --replace would remove its siblings): `bpmn ext remove <file> <id> \'camunda:executionListener[event=finish]\'`, then e.g. `bpmn ext add <file> <id> camunda:executionListener event=start delegateExpression=${...}`.' },
  { code: 'W_C7_DEPLOY_EXTENSION', meaning: 'Invalid content of camunda extension elements: camunda:in/out without source and target (and without variables / businessKey), a parameter without name, a form field without id or with a type other than string / long / boolean / date / enum, a connector without connectorId, a camunda:field without a value (or with stringValue and camunda:string together) where the engines read fields (class / delegateExpression tasks, message throws and listeners, shell tasks); the engines refuse the file.', fix: '`bpmn ext list <file> <id> --json`, then re-add the item complete (`bpmn ext add <file> <id> camunda:field name=a stringValue=b`: keyed items replace the old one); a repeatable item without key is removed by its selector and added again (the hint has both commands).' },
  { code: 'W_C7_DEPLOY_EVENT_GATEWAY', meaning: 'An event-based gateway branch is not a message / timer / signal / conditional intermediate catch event (receive tasks included; of several event definitions the one the engines act on counts), a catch event after it has other incoming flows, or two branches wait for one message / signal name; the engines refuse the file.', fix: '`bpmn add <file> intermediateCatchEvent:message "<Name>" --flow <flowId> --message <Msg>` in front of the target, or rename one message / signal.' },
  { code: 'W_C7_DEPLOY_MESSAGE', meaning: 'A catching message event (or receive task) without messageRef or with a nameless bpmn:Message, or two subscriptions to one message name in one engine scope: the start events of a process; the event sub-process starts of a (sub-)process together with the boundary events on that sub-process (a multi-instance host is a scope of its own); a receive task together with its boundary events. The engines refuse the file.', fix: '`bpmn set <file> <id> message=<MessageName>` (creates the bpmn:Message when missing).' },
  { code: 'W_C7_DEPLOY_SIGNAL', meaning: 'A signal event without signalRef or with a nameless signal, two root signals with one name, or two subscriptions to one signal name in one engine scope (two signal start events, two boundary events of one host, an event sub-process start and a boundary event on its sub-process); the engines refuse the file.', fix: '`bpmn set <file> <id> signal=<SignalName>`, or rename the signal.' },
  { code: 'W_C7_DEPLOY_ERROR', meaning: 'An error end event without errorRef, or whose bpmn:Error has no errorCode; the engines refuse the file.', fix: '`bpmn set <file> <id> error=<ErrorName> errorCode=<CODE>`.' },
  { code: 'W_C7_DEPLOY_ESCALATION', meaning: 'An escalation throw / end event without escalationRef or escalationCode, or an escalation boundary event on something other than a sub-process, call activity or user task; the engines refuse the file.', fix: '`bpmn set <file> <id> escalationCode=<CODE>`, or move / remove the boundary event.' },
  { code: 'W_C7_DEPLOY_EVENT_DEFINITION', meaning: 'A timer without date, cycle or duration, or a compensation activityRef outside the throw event\'s (sub-)process (an event sub-process may name activities of its parent scope); or, by the BPMN schema, a conditional event definition without a condition element (an empty one or a camunda:resource script deploys: W_C7_EMPTY_CONDITION / fine) or a timer definition with more than one of timeDate, timeCycle and timeDuration. The engines refuse the file. The schema rules hold for every event definition in the file: also for one the engines ignore next to another (W_C7_MULTIPLE_EVENT_DEFINITIONS) and in non-executable processes.', fix: '`bpmn set <file> <id> timer=PT1H`, `bpmn set <file> <id> \'when=${...}\'`, or `bpmn set <file> <id> definition.activityRef=<activityId>` (the hint lists the candidates); a definition the engines ignore is dropped with `bpmn set <file> <id> trigger=<acting trigger>`.' },
  { code: 'W_C7_DEPLOY_START_EVENT', meaning: 'A process or embedded sub-process without a start event, also an empty one ("must define a startEvent element"; a transaction without one deploys: W_C7_TRANSACTION_NO_START), a second none or timer start event in a process (message / signal / conditional start events may be added), or a second start event of any kind in a sub-process (event sub-processes and transactions included); the engines refuse the file. Replaces W_NO_START / W_EMPTY_SUBPROCESS for the same (sub-)process.', fix: 'A second start event: remove it when the first one already reaches where it leads (`bpmn remove <file> <extraStartId>`, its flows go with it), else start its branch from the first one (`bpmn set <file> <flowId> source=<startId>`, then remove it) or give a process start another trigger (`bpmn set <file> <id> trigger=message message=<Name>`); the hint names the flows and never moves one into a node the first start already reaches. A missing start: `bpmn add <file> startEvent "<Name>" --before <firstNodeId>` (`--in <id>` when empty).' },
  { code: 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', meaning: 'An ad-hoc sub-process with a sequence flow into or out of it, or a boundary event on it: the engines do not run ad-hoc sub-processes and refuse the file ("Invalid destination / source of sequence flow", "Invalid reference in boundary event"); one with a multi-instance loop is refused by Camunda 7 and CIB seven too (Operaton deploys a valid loop; the loop rules of W_C7_DEPLOY_MULTI_INSTANCE hold on all three). One that nothing connects deploys and is skipped with its content, so the profile does not check that content.', fix: '`bpmn retype <file> <id> subProcess`, then give its content a start event and flows (`bpmn add <file> startEvent "<Name>" --in <id>`, `bpmn connect <file> <fromId> <toId>`); or drop the loop: `bpmn set <file> <id> loop=none`.' },
  { code: 'W_C7_DEPLOY_LINK', meaning: 'A link event definition without a name (BPMN schema: every one in the file, also one the engines ignore next to another and in non-executable processes), two link catch events with one name in a process (sub-processes included), or a link throw event reached by a flow with no catch event of its name in its own (sub-)process; the engines refuse the file.', fix: '`bpmn set <file> <eventId> link=<Name>`, or add the catching side: `bpmn add <file> intermediateCatchEvent:link "<Name>" --in <scopeId> --link <Name>`.' },
  { code: 'W_C7_DEPLOY_SCHEMA', meaning: 'An attribute without namespace prefix that the BPMN schema does not define (calledDecision="..." on a businessRuleTask, assignee="..." on a userTask), anywhere in the file: non-executable processes, the diagram and bpmn:definitions included. The engines validate the file against the schema and refuse it.', fix: 'Remove it: `bpmn set <file> <id> <attr>=` (on an event definition, loop or condition: `definition.<attr>=` / `loop.<attr>=` / `condition.<attr>=`); a vendor attribute needs its prefix: `bpmn set <file> <id> assignee= camunda:assignee=<value>`. A business rule task\'s calledDecision (design-iq\'s decision link) is converted: `bpmn set <file> <id> calledDecision=<decision>` writes camunda:decisionRef and removes it.' },
  { code: 'W_C7_DEPLOY_BOUNDARY_HOST', meaning: 'A boundary event is attached to a compensation handler (isForCompensation=true); the engines refuse the file. `validate` and writes report it as the structural error E_INVALID_HOST instead (the profile alone, `runProfile`, reports this code).', fix: '`bpmn remove <file> <id>` or `bpmn move <file> <id> --on <activityId>`.' },
  { code: 'W_C7_DEPLOY_SCRIPT', meaning: 'A script task has neither a script nor camunda:resource; the engines refuse the file.', fix: '`bpmn set <file> <id> scriptFormat=groovy \'script=...\'` (or camunda:resource=deployment://<file>).' },
  { code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', meaning: 'An exclusive gateway without outgoing flow, a single outgoing flow with a condition, a default flow with a condition, or flows without condition next to a default (or more than one without condition); the engines refuse the file.', fix: '`bpmn set <file> <flowId> \'condition=${...}\'` or `bpmn set <file> <flowId> default=true`.' },
  { code: 'W_C7_DEPLOY_DEFINITIONS_EXTENSION', meaning: 'bpmn:extensionElements directly under bpmn:definitions (the BPMN schema does not allow them there); the engines refuse the file.', fix: '`bpmn ext remove <file> <definitionsId> <type>`, then `bpmn ext add <file> <processId> ...`.' },
  { code: 'W_C7_UNKNOWN_ATTRIBUTE', meaning: 'A camunda attribute (on a BPMN element or inside camunda content) the Camunda descriptor does not know, e.g. a typo; the engines ignore it. The message suggests the closest known name.', fix: 'Replace it: `bpmn set <file> <id> camunda:asignee= camunda:assignee=<value>`.' },
  { code: 'W_C7_MISPLACED_ATTRIBUTE', meaning: 'A camunda attribute on an element type that does not read it (camunda:assignee on a serviceTask, camunda:collection on the activity, errorCodeVariable on the event instead of its definition), or on the side of an event definition the engines do not read it on: type / topic / class / delegateExpression / expression / resultVariable / taskPriority on a message catch event, camunda:async on a signal catch event, errorCodeVariable / errorMessageVariable on an error end event, escalationCodeVariable on an escalation throw; it has no effect.', fix: 'Move it with the definition. / loop. / condition. keys of set (the hint has the command), or remove it: `bpmn set <file> <id> camunda:<attr>=` (`definition.camunda:<attr>=`).' },
  { code: 'W_C7_UNKNOWN_ELEMENT', meaning: 'A camunda extension element type the Camunda descriptor does not know (camunda:inputOutputt, camunda:values); the engines ignore it.', fix: '`bpmn ext remove <file> <id> <index>` and add the right type.' },
  { code: 'W_C7_MISPLACED_EXTENSION', meaning: 'A camunda extension element on a host that does not read it (taskListener, camunda:in or formData on a serviceTask; inputOutput on the process or a flow; camunda:field / connector on a message catch event definition, camunda:in on a signal catch), a child type loose in extensionElements, or a child in the wrong container; the engines ignore it.', fix: '`bpmn ext remove <file> <id> <selector>` (the hint has it), then add it where it belongs with `bpmn ext add <file> <hostId> <type> ...` (child types go into their container automatically).' },
  { code: 'W_C7_FOREIGN_CONTENT', meaning: 'zeebe:* attributes or extension elements in a Camunda 7 file; Camunda 7 ignores them.', fix: '`bpmn set <file> <id> zeebe:<attr>=` or `bpmn ext remove <file> <id> zeebe:<type>`, and use the camunda equivalent.' },
  { code: 'W_C7_BAD_VALUE', meaning: 'A value the engines accept but misread: a boolean other than exactly true / false (asyncBefore=yes stays off), an unknown calledElement / case / decisionRef binding, variableEvents other than create / update / delete, an empty topic or calledElement, a non-numeric user task priority.', fix: '`bpmn set <file> <id> camunda:<attr>=<valid value>` (the hint names it).' },
  { code: 'W_C7_MESSAGE_NO_IMPLEMENTATION', meaning: 'A message throw or end event without implementation: it sends nothing and behaves like a none event at run time.', fix: '`bpmn set <file> <id> definition.camunda:type=external definition.camunda:topic=<topic>` (or definition.camunda:delegateExpression=${...}).' },
  { code: 'W_C7_TRANSACTION_NO_START', meaning: '(runtime) A transaction without a start event (also an empty one): unlike an embedded sub-process it deploys, but every instance that reaches it fails ("No initial activity found for subprocess"). Replaces W_NO_START / W_EMPTY_SUBPROCESS for the same transaction.', fix: '`bpmn add <file> startEvent "<Name>" --before <firstNodeId>` (`--in <id>` when empty), or `bpmn remove <file> <id>`.' },
  { code: 'W_C7_EMPTY_CONDITION', meaning: '(runtime) A condition with no expression and no camunda:resource, on a conditional event or on a sequence flow the engines evaluate (not a default flow, not out of a parallel or event-based gateway). It deploys, but every evaluation fails ("condition expression returns non-Boolean" / "condition script returns null").', fix: '`bpmn set <file> <flowId> \'condition=${...}\'` (or `condition=` to drop it); a conditional event: `bpmn set <file> <id> \'when=${...}\'` or `bpmn set <file> <id> condition.camunda:resource=deployment://<script> condition.language=groovy`.' },
  { code: 'W_C7_MULTIPLE_EVENT_DEFINITIONS', meaning: '(runtime) An event with several event definitions (BPMN "multiple"): the engines act on one and do not even parse the others. Engine-checked order: intermediate catch timer > signal > message > link > conditional; process start timer > message > signal > conditional; event sub-process start message > signal > timer > conditional; boundary timer > signal > message > conditional; intermediate throw signal > message; end message > signal. The other W_C7_DEPLOY_* rules look at the acting definition only, like the engines, except the schema rules (a conditional definition without condition element, a link definition without name, a timer definition with two time elements): the engines validate the file against the BPMN schema before they pick a definition, so these refuse the file on an ignored definition too.', fix: 'Keep one: `bpmn set <file> <id> trigger=<t>` (keeps that definition, drops the others), and model every other trigger as its own event (behind an event-based gateway, or another boundary / start event). One definition is edited with `bpmn set <file> <id> \'definition[<n>].<key>=<value>\'`.' },
  { code: 'W_C7_DANGLING_REF', meaning: 'An id reference inside camunda content (camunda:errorEventDefinition errorRef) points to no element of the right type; the mapping is ignored at run time.', fix: 'Rebuild just that mapping (the hint has both commands; --replace would remove the other mappings): `bpmn ext remove <file> <id> \'camunda:errorEventDefinition[id=<mappingId>]\'`, then `bpmn ext add <file> <id> camunda:errorEventDefinition id=<mappingId> errorRef=<ErrorId> expression=${...}`.' },
  { code: 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', meaning: '(practice) An exclusive gateway has exactly one flow without condition and no default; the engine takes it as the default and logs a warning.', fix: '`bpmn set <file> <flowId> default=true`.' },
  { code: 'W_C7_DUPLICATE_EXTENSION', meaning: '(practice) A second camunda:failedJobRetryTimeCycle on an element that is not asynchronous yet; the engines refuse the file once it is.', fix: 'Keep one: `bpmn ext add <file> <id> camunda:failedJobRetryTimeCycle --replace --body R3/PT5M`.' },
  { code: 'W_DECISION_RESULT_VARIABLE', meaning: '`set <id> calledDecision=<decision>` in a Camunda 8 file wrote a zeebe:calledDecision without a resultVariable; Camunda 8 requires one to deploy.', fix: '`bpmn ext add <file> <id> zeebe:calledDecision decisionId=<decision> resultVariable=<variable> --replace`.' },
  // design profile (the design-iq save gate; `--profile design`, auto for the models of a content repository)
  { code: 'E_DESIGN_*', meaning: 'An error of the design profile, which mirrors the save gate of Miragon\'s design-iq (@bpmiq/validator): design-iq refuses to save a model with such an error. The profile runs with `--profile design`, and by default (`--profile auto`) for the models of a design-iq content repository (a bpmiq.yml in the file\'s directory or above names a models folder that contains the file). It checks the result after the layout; like a structural error, one a change introduces blocks the write (E_VALIDATION) and one the file already had is W_PREEXISTING_ERROR. Findings carry `"validator": "design"` (`[design]` in text).', fix: 'Each finding\'s hint names the command. Make an edit that passes through an invalid state (a new start event before its path exists) in one transaction (`bpmn apply <file> ops.json`), or draft with `--profile none` and fix what `bpmn validate <file> --profile design` reports before saving.' },
  { code: 'E_DESIGN_START_EVENTS', meaning: 'A process with flow nodes has no or more than one start event, or an embedded sub-process (not an event sub-process) has more than one; design-iq requires exactly one per process.', fix: 'None: `bpmn add <file> startEvent "<Name>" --before <firstNodeId>`. Several: keep one (`bpmn remove <file> <startId>`) and model the alternatives after it (an event-based gateway), or move a triggered start into an event sub-process.' },
  { code: 'E_DESIGN_UNREACHABLE', meaning: 'A flow node without incoming sequence flow (start events, boundary events and event sub-processes excepted), counted like design-iq: one sequence flow per id (flows without id, or sharing an id, count once). design-iq checks every node, also where BPMN allows it: a compensation handler, a catching link event and the content of an ad-hoc sub-process are errors there too (the message says so).', fix: '`bpmn connect <file> <fromId> <id>` or `bpmn move <file> <id> --after <nodeId>`, or remove it; a construct design-iq cannot save is removed or kept with --profile none.' },
  { code: 'E_DESIGN_DEAD_END', meaning: 'A flow node without outgoing sequence flow (end events and event sub-processes excepted), boundary events included, counted like design-iq: one sequence flow per id (flows without id, or sharing an id, count once). design-iq checks every node, also where BPMN allows it: a compensation handler or compensation boundary event, a throwing link event and the content of an ad-hoc sub-process are errors there too.', fix: '`bpmn add <file> endEvent "<Name>" --after <id>` or `bpmn connect <file> <id> <toId>`; a construct design-iq cannot save is removed or kept with --profile none.' },
  { code: 'E_DESIGN_NOT_IN_LANE', meaning: 'The process has lanes and this node (not a boundary event) is in none of its top-level lanes. design-iq reads the top-level lanes only: a node in a child lane must be listed by its top-level lane too (bpmn-js writes it so).', fix: '`bpmn set <file> <id> lane=<laneId>`.' },
  { code: 'E_DESIGN_NO_DI', meaning: 'A flow node, sequence flow, data object / store reference, text annotation, association, group, top-level lane, participant or message flow has no shape or edge in the diagram; design-iq\'s visual editor breaks without it (hard rule 2). Usually the result of --no-layout.', fix: 'Write with the layout (new elements are placed next to their neighbours), or `bpmn layout <file>` (redraws everything).' },
  { code: 'E_DESIGN_NAMESPACE', meaning: 'The file uses a namespace prefix it never declares, found the way design-iq finds it: two regular expressions on the raw text (`<p:name` before whitespace, `/` or `>`, and whitespace + `p:name="`), so text, CDATA, comments and attribute values that look like a prefixed element or attribute count too (a documentation `Set app:mode="prod"`). design-iq refuses such a file; prefixed markup without declaration is also unreadable for bpmn-moddle (E_IMPORT_LOSSY on a write).', fix: 'Markup: declare xmlns:<prefix> on bpmn:definitions in the XML, or let a --force write drop the unreadable content. Text: reword it (`app: mode=` with a space, or no quote after `=`) with `bpmn set <file> <id> documentation=<text>`.' },
  { code: 'E_DESIGN_NO_PROCESS', meaning: 'The file has no bpmn:process.', fix: 'Create the model with `bpmn new <file> --name "<Name>"`.' },
  { code: 'E_DESIGN_XML', meaning: 'The file is not well-formed XML although bpmn-moddle reads it: an attribute is written twice on one element (bpmn-moddle drops that element, E_IMPORT_LOSSY on a write). design-iq\'s parser refuses the file and checks nothing else; neither does the profile.', fix: 'Remove one of the two attributes in the XML.' },
  { code: 'W_DESIGN_*', meaning: 'A warning of the design profile (see E_DESIGN_*): design-iq saves the model but warns. A write reports the ones it introduced.', fix: 'The hint of each finding names the command.' },
  { code: 'W_DESIGN_COMPLEXITY', meaning: 'The file has more than 9 activities (design-iq\'s 7 +- 2 rule; sub-process content counts).', fix: 'Extract a coherent part into its own model and call it (`bpmn add <file> callActivity "<Name>" ... calledElement=<processId>`).' },
  { code: 'W_DESIGN_CALL_LINK', meaning: 'A call activity of a design model (no engine namespace) calls no process, or, inside a content repository, calls a process that is no .bpmn of its models folder (design-iq: refs/dangling).', fix: '`bpmn set <file> <id> calledElement=<processId>` (in design-iq the process id is the file stem of its .bpmn).' },
  { code: 'W_DESIGN_DECISION_LINK', meaning: 'A business rule task of a design model calls no decision, or, inside a content repository, calls a decision that is no .dmn of its models folder (design-iq: refs/dangling).', fix: '`bpmn set <file> <id> calledDecision=<decisionId>` (in design-iq the decision id is the file stem of its .dmn).' },
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
  /** non-event kinds that take the option too (sendTask / receiveTask: --message) */
  alsoOn?: string[];
}

export const TRIGGER_OPTIONS: TriggerOptionDoc[] = [
  { trigger: 'none', option: '(no option)', keys: [], description: 'plain event; the default for start/end/throw events in `add` (`retype` keeps the current trigger unless the suffix :none is given)' },
  { trigger: 'message', option: '--message <name>', keys: ['message'], description: 'root bpmn:Message found by name, created when missing', alsoOn: ['sendTask', 'receiveTask'] },
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

/** How new ids are made (README "Ids", src/idstyle.ts); `bpmn kinds --json` -> `ids`. */
export const ID_CONVENTIONS = {
  rule: 'New ids follow the id style of the file; explicit ids (--id, "id") are taken as given. A rule needs two ids that follow it (one id of a kind in a file whose ids are mostly prefixed).',
  default: { element: '<Prefix>_<NameSlug> (prefix: `prefix` of the kind)', unnamed: '<Prefix>_<hash>', flow: 'Flow_<hash>', di: '<id>_di in files with DI of that form; BPMNShape_<id> / BPMNEdge_<id> in a new drawing' },
  prefixes: 'per kind (and trigger) as the file has them; else the family prefix the file shares (Task_); else the type name when the file names prefixes after types (serviceTask_); else the bpmn-cli prefix in the case of the file. No prefix counts too: where the file\'s ids of a kind or family have none (checkOrder), or its flow nodes mostly have none, a named element gets a bare camelCase (PascalCase) id; an unnamed one keeps a prefix',
  bodies: { pascal: 'CheckInvoice', camel: 'checkInvoice', snake: 'check_invoice', pascalSnake: 'Check_Invoice', hash: '0k3x9qa', numbered: '12' },
  unnamed: 'numbered when the file numbers unnamed elements, else hash',
  flowForms: { hash: 'Flow_0k3x9qa', numbered: 'Flow_12 (or flow12)', stemTo: 'flow_checkStockToShipGoods', idPair: 'Flow_<sourceId>_<targetId>', stemSnake: 'Flow_check_stock_to_ship_goods', idSnake: 'Flow_<sourceId>_to_<targetId>', scopedTo: 'Flow_<scope>_<SourceWord>To<TargetWord> (Flow_KotO_ValidateToReserve; Start / End for start and end events)' },
  hash: 'seven base-36 characters like a Camunda Modeler id, hashed from stable inputs (flow ends; kind, name and placement of a node): the same edit gives the same id, independent edits on two branches do not collide',
  transliteration: 'ä -> ae, ö -> oe, ü -> ue, ß -> ss; other accents dropped',
  di: 'a full redraw keeps the ids of existing DI elements, planes and diagrams; new DI follows the DI ids of the file',
};

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
  { name: 'new', usage: 'bpmn new <file> [--name <text>] [--id <processId>] [--no-executable] [--target camunda8|camunda7]', summary: 'Create a file with one empty process. --target camunda7 (also for CIB seven and Operaton) writes what Camunda Modeler writes: the camunda / modeler namespaces, the platform version and camunda:historyTimeToLive=180 (the engines refuse an executable process without it).', examples: ['bpmn new order.bpmn --name "Order handling" --target camunda8', 'bpmn new order.bpmn --name "Order handling" --target camunda7'] },
  { name: 'show', usage: 'bpmn show <file> [<id> [--context]] [--json] [--scope <id>] | bpmn show <file> --around <id> [--depth <n>] [--inner] [--json] | bpmn show <file> --layout [--json]', summary: 'Print the model in flow order (no coordinates), or every detail of one element. Every node carries its lane (lane=<id>); vendor attributes appear with their values next to the properties (nested ones under their set keys: loop.camunda:collection=${items}), extension types as `ext: camunda:taskListener x3`; the process line carries the process\'s own; a business rule task shows its decision link as calledDecision=<id> in every spelling; message flows name their endpoints, the collaboration lists its annotations. --around <id> prints only the neighbourhood of an element (--depth flow steps both ways, default 2; see READING LARGE MODELS), <id> --context the element in its context (where, lane, before / after, catching events, message flows). --layout prints the drawing instead: per pool / lane the rows of node ids (left to right), colours, labels off their default side and the layout problems with ids. `-` as the file reads stdin.', examples: ['bpmn show order.bpmn', 'bpmn show order.bpmn --around Activity_CheckInvoice', 'bpmn show order.bpmn Activity_CheckInvoice --context', 'bpmn show order.bpmn Activity_CheckInvoice --json', 'bpmn show order.bpmn --layout'] },
  { name: 'find', usage: 'bpmn find <file> <text> [--kind <kind>] [--json]', summary: 'Find elements by id or name substring, or by a vendor attribute value (topic, assignee, candidate groups, listener class, extension attributes and bodies; the hit shows the match); --kind accepts any kind plus sequenceFlow, messageFlow, association, dataAssociation, process, collaboration, message, error, signal, escalation.', examples: ['bpmn find order.bpmn invoice --kind userTask', 'bpmn find order.bpmn charge-card'] },
  { name: 'add', usage: 'bpmn add <file> <kind[:trigger]> [<name>] [--id <id>] [placement] [--to <id>] [--lane <laneId>] [flow options] [trigger options] [--collapsed] [--if-absent] [--doc <text>] [--text <text>] [--process <id>] [--black-box] [--members <id,...>] [key=value ...]', summary: 'Create one element and wire it in (see PLACEMENT and TRIGGERS). Pools: the first participant wraps the existing process, later ones get a new process; --black-box creates a pool without a process and never wraps, so add a normal pool first.', examples: ['bpmn add order.bpmn start "Order received"', 'bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived', 'bpmn add order.bpmn boundary:timer "2 days" --on Activity_CheckInvoice --timer PT2D --non-interrupting', 'bpmn add order.bpmn participant "Order handling"', 'bpmn add order.bpmn participant "Customer" --black-box'] },
  { name: 'connect', usage: 'bpmn connect <file> <sourceId> <targetId> [--name <text>] [--id <id>] [--condition <expr>] [--language <lang>] [--default] [--message <name>] [--if-absent]', summary: 'Connect two elements; sequence flow, message flow, association or data association is inferred from the endpoints.', examples: ["bpmn connect order.bpmn Gateway_InvoiceOk Activity_BookInvoice --name yes --condition '${ok}'", 'bpmn connect order.bpmn Activity_SendOffer Participant_Customer --message Offer'] },
  { name: 'set', usage: 'bpmn set <file> <id> <key=value ...> [--unset <key>]...', summary: 'Set properties (name, doc, condition, timer, loop, camunda:assignee, ...); key= or --unset removes. Nested elements without an id take a prefix: definition.<key> (event definition), loop.<key> (loop characteristics), condition.<key> (condition expression); see NESTED KEYS in `bpmn kinds`. calledDecision= links a business rule task to its decision in the file\'s spelling (design model: calledDecision, Camunda 7: camunda:decisionRef, Camunda 8: zeebe:calledDecision).', examples: ['bpmn set order.bpmn Activity_CheckInvoice name="Check the invoice" camunda:assignee=kermit', 'bpmn set order.bpmn Flow_1qqra0u condition=\'${amount > 100}\'', 'bpmn set order.bpmn Activity_CheckInvoice --unset doc', "bpmn set order.bpmn Activity_CheckInvoice 'loop.camunda:collection=${invoices}' loop.camunda:elementVariable=invoice", 'bpmn set order.bpmn Activity_RateRisk calledDecision=risk-rating'] },
  { name: 'remove', usage: 'bpmn remove <file> <id...> [--no-bridge] [--if-exists]', summary: 'Remove elements with cascade; a node with one in / one out is bridged (predecessor -> successor) unless --no-bridge.', examples: ['bpmn remove order.bpmn Activity_Old', 'bpmn remove order.bpmn Event_Timeout Flow_1y8i3yl --if-exists'] },
  { name: 'retype', usage: 'bpmn retype <file> <id> <kind[:trigger]> [trigger options]', summary: 'Change the kind (task <-> task/subProcess/callActivity, gateway <-> gateway, event <-> event of the same position, trigger changes) keeping id, name, flows and extensions. A kind without trigger suffix keeps the current trigger; <kind>:none (or `set <id> trigger=none`) drops it. Same trigger, new details: the event definition (id, vendor attributes) is kept. A sub-process with content becomes a task / callActivity only with --force (E_WOULD_DROP_CONTENT).', examples: ['bpmn retype order.bpmn Activity_CheckInvoice serviceTask', 'bpmn retype order.bpmn Event_Start startEvent:message --message OrderReceived', 'bpmn retype order.bpmn Event_Start startEvent:none'] },
  { name: 'move', usage: 'bpmn move <file> <id...> [--after <id>] [--before <id>] [--flow <flowId>] [--in <scopeId>] [--on <activityId>] [--lane <laneId>]', summary: 'Relocate nodes (they are detached with bridging, then placed again) and/or assign a lane.', examples: ['bpmn move order.bpmn Activity_Clarify --after Activity_CheckInvoice', 'bpmn move order.bpmn Activity_Book Activity_Ship --lane Lane_Backoffice'] },
  { name: 'order', usage: 'bpmn order <file> <nodeId> <flowId...> | bpmn order <file> <poolId|processId|laneId> <laneId...>', summary: 'Set the declaration order of a node\'s outgoing flows. In the diagram the default flow (else the first flow) continues straight and the others alternate below/above it in this order (see PLACEMENT). With lane ids: the lanes of a pool / process / parent lane top to bottom (laneSet and diagram bands).', examples: ['bpmn order order.bpmn Gateway_InvoiceOk Flow_yes Flow_no', 'bpmn order order.bpmn Participant_OrderHandling Lane_Backoffice Lane_Sales'] },
  { name: 'ext', usage: 'bpmn ext add <file> <id> <type|path> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace] | bpmn ext remove <file> <id> <selector|index> | bpmn ext list <file> <id> [--json]', summary: 'Vendor extension elements inside <bpmn:extensionElements> (sub-command first, then file and element id). Child types go into their container (camunda:inputParameter -> camunda:inputOutput, camunda:formField -> camunda:formData, zeebe:input -> zeebe:ioMapping), single-instance containers are merged (E_DUPLICATE_EXTENSION on a conflict; --replace replaces), an item with the same key (name / id / target) is replaced. A path reaches nested containers (camunda:connector/camunda:inputParameter); remove takes a selector (\'camunda:inputParameter[name=x]\', \'camunda:formField[1]\'). A definition. / loop. / condition. prefix addresses the nested element (loop.camunda:failedJobRetryTimeCycle). Quote selectors in the shell.', examples: ['bpmn ext add order.bpmn Activity_BookInvoice zeebe:taskDefinition type=book-invoice retries=3', 'bpmn ext add order.bpmn Activity_BookInvoice zeebe:ioMapping --xml \'<zeebe:ioMapping><zeebe:input source="=amount" target="total"/></zeebe:ioMapping>\'', "bpmn ext add order.bpmn Activity_ChargeCard camunda:inputParameter name=amount --body '${order.total}'", "bpmn ext remove order.bpmn Activity_ChargeCard 'camunda:inputParameter[name=amount]'", 'bpmn ext list order.bpmn Activity_BookInvoice', 'bpmn ext remove order.bpmn Activity_BookInvoice zeebe:taskDefinition'] },
  { name: 'apply', usage: 'bpmn apply <file> [<ops.json> | -]', summary: 'Run a list of ops (JSON) as one transaction: all or nothing, one layout at the end, then the format ops in batch order. `-` as the ops reads them from stdin; `-` as the file reads the model from stdin (the ops then come from a file) and writes the result to stdout.', examples: ['bpmn apply order.bpmn ops.json', "echo '[{\"op\":\"add\",\"kind\":\"userTask\",\"name\":\"Ship\",\"after\":\"Activity_BookInvoice\"}]' | bpmn apply order.bpmn -", 'cat order.bpmn | bpmn apply - ops.json > new.bpmn'] },
  { name: 'place', usage: 'bpmn place <file> <id...> [--row-of <id> | --below <id> | --above <id>] [--column-of <id> | --after <id> | --before <id>]', summary: 'Diagram only: move shapes as one rigid group so the first lands on the row and/or column of another element; boundary events and labels follow, others give way, flows are rerouted. Refuses to leave the lane / pool / sub-process (E_LEAVES_CONTAINER).', examples: ['bpmn place order.bpmn Activity_ClarifyInvoice Event_ReminderSent --below Activity_BookInvoice', 'bpmn place order.bpmn Event_InvoiceHandled --row-of Activity_CheckInvoice --after Gateway_InvoiceOk_join'] },
  { name: 'align', usage: 'bpmn align <file> <id...> --axis row|column [--to <id>]', summary: 'Diagram only: put shapes on one row (same vertical centre) or one column (same horizontal centre) as --to (default: the first id).', examples: ['bpmn align order.bpmn Event_InvoiceHandled Event_ReminderSent --axis column'] },
  { name: 'color', usage: `bpmn color <file> <id...> --color ${Object.keys(SWATCHES).join('|')}|default`, summary: 'Diagram only: colour shapes and connections with a bpmn-js colour picker colour; default removes it. Colours survive every later write.', examples: ['bpmn color order.bpmn Activity_CheckInvoice Flow_024yl5b Gateway_InvoiceOk --color red'] },
  { name: 'label', usage: 'bpmn label <file> <id> --side above|below|left|right', summary: 'Diagram only: put the external label of an event, gateway, data object / store or flow on one side (flows: of their longest horizontal / vertical segment).', examples: ['bpmn label order.bpmn Gateway_InvoiceOk --side below'] },
  { name: 'route', usage: 'bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]', summary: 'Diagram only: route one sequence / message flow again, optionally forcing the side it leaves its source and enters its target by.', examples: ['bpmn route order.bpmn Flow_02tom5g --exit bottom --entry bottom'] },
  { name: 'space', usage: 'bpmn space <file> (--after <id> | --below <id>) [--by column|row|<px>]', summary: 'Diagram only: the modeler\'s space tool: everything right of (--after, within the pool) or below (--below) the element moves by one column / row (default) or <px>; frames grow. On a lane or pool it makes that frame bigger.', examples: ['bpmn space order.bpmn --after Activity_CheckInvoice', 'bpmn space order.bpmn --below Lane_Sales --by 80'] },
  { name: 'tidy', usage: 'bpmn tidy <file> [<id>...]', summary: 'Diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order (default: every shape). Same as `bpmn layout <file> --tidy`.', examples: ['bpmn tidy order.bpmn'] },
  { name: 'validate', usage: 'bpmn validate <file> [--json] [--strict] [--platform auto|c7|c8|none] [--profile auto|design|none]', summary: 'Structural errors (an error a change introduces blocks its write), lint warnings, the engine profile of the file\'s platform (Camunda 7 today: W_C7_* findings with a severity; W_C7_DEPLOY_* = the engines refuse the file) and the validation profile (design: design-iq\'s save gate, E_DESIGN_* errors fail the check; auto runs it for the models of a design-iq content repository), without changing the file. The platform is detected from modeler:executionPlatform or the vendor namespace; --platform overrides it.', examples: ['bpmn validate order.bpmn --json', 'bpmn validate order.bpmn --platform c7 --strict', 'bpmn validate order.bpmn --profile design'] },
  { name: 'layout', usage: 'bpmn layout <file> [--expand <id,...>] [--collapse <id,...>] | bpmn layout <file> --tidy', summary: 'Redraw the whole diagram (DI) from the model, optionally changing which sub-processes are expanded (always redraws, a hand layout is replaced; there is no --no-layout here). --tidy keeps the drawing and only removes overlaps (= bpmn tidy).', examples: ['bpmn layout order.bpmn --collapse Activity_Payment', 'bpmn layout order.bpmn --tidy'] },
  { name: 'metrics', usage: 'bpmn metrics <file> [--json]', summary: 'Layout quality of the drawing: the score and every problem (crossings, overlaps, flows through shapes, labels on lines, nodes outside their lane / pool, frames covering foreign shapes, ...) with the element ids.', examples: ['bpmn metrics order.bpmn --json'] },
  { name: 'kinds', usage: 'bpmn kinds [--section <name,...>] [--json [--pretty]]', summary: 'Kind table, trigger options, set keys, placement grammar, ops schema and error catalogue; --section prints only the named parts (kinds, triggers, setKeys, nestedKeys, placement, ops, layoutModes, ids, profiles, colors, errors, exitCodes; with --json those keys).', examples: ['bpmn kinds', 'bpmn kinds --section ops --json', 'bpmn kinds --section errors'] },
  { name: 'guide', usage: 'bpmn guide [--short | <topic>]', summary: 'This cheat sheet; --short the core in at most 5 KB, <topic> one section (see TOPICS).', examples: ['bpmn guide --short', 'bpmn guide format'] },
];

/** The validation profiles (`--profile`, MutationOptions.profile; `bpmn kinds --json` -> profiles). */
export const PROFILE_DOCS: Array<{ profile: string; description: string; codes?: string[] }> = [
  { profile: 'auto', description: 'Default: the design profile for the models of a design-iq content repository (a bpmiq.yml in the file\'s directory or above names a models folder that contains the file), no profile otherwise.' },
  {
    profile: 'design',
    description: 'design-iq\'s save gate (@bpmiq/validator): errors a change introduces block the write (E_VALIDATION), errors the file had are W_PREEXISTING_ERROR, introduced warnings are reported; validate reports all of them. Inside a content repository call and decision links are checked against its .bpmn / .dmn file stems.',
    codes: ['E_DESIGN_START_EVENTS', 'E_DESIGN_UNREACHABLE', 'E_DESIGN_DEAD_END', 'E_DESIGN_NOT_IN_LANE', 'E_DESIGN_NO_DI', 'E_DESIGN_NAMESPACE', 'E_DESIGN_NO_PROCESS', 'E_DESIGN_XML', 'W_DESIGN_COMPLEXITY', 'W_DESIGN_CALL_LINK', 'W_DESIGN_DECISION_LINK'],
  },
  { profile: 'none', description: 'No validation profile (structural validation, lint and the engine profile still run).' },
];

export const COMMON_OPTIONS: Array<{ option: string; description: string }> = [
  { option: '--json', description: 'machine-readable result on stdout, compact (errors as JSON on stderr)' },
  { option: '--pretty', description: 'with --json: indented JSON' },
  { option: '--summary', description: 'a short result: created ids by kind, changed / removed ids, the added warnings, one layout line (score, added problems)' },
  { option: '-o, --out <file>', description: 'write to another file instead of in place (also when the result equals the input); `-o -` writes the XML to stdout (the report goes to stderr)' },
  { option: '--dry-run', description: 'report what would change, write nothing' },
  { option: '--layout <mode>', description: `${LAYOUT_MODES.join(' | ')}: auto (default) keeps a hand-made or formatted drawing and places changes locally, and redraws a new file or a drawing the engine made and nobody changed; incremental always keeps; full always redraws (colours and DI ids survive)` },
  { option: '--relayout', description: 'redraw the whole diagram (= --layout full)' },
  { option: '--no-layout', description: 'write without updating the diagram (stale DI of removed elements is pruned, new elements have no shape until `bpmn layout`; format operations still apply to the existing drawing)' },
  { option: '--force', description: 'write although the import was lossy (E_IMPORT_LOSSY), the change introduces validation errors (E_VALIDATION; errors the file already had never block) or a retype would delete a sub-process\'s content (E_WOULD_DROP_CONTENT); for `new`: overwrite an existing file' },
  { option: '--profile <auto|design|none>', description: 'validation profile: design checks the result against design-iq\'s save gate (one start event per process, every node with incoming and outgoing flow, every node in a lane, a complete diagram; E_DESIGN_* errors the change introduces block the write); auto (default) runs it for the models of a design-iq content repository (a bpmiq.yml above the file); none switches it off' },
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
  const rows = TRIGGER_OPTIONS.map((t) => [t.trigger, t.option, t.description, `on: ${[...kindsWithTrigger(t.trigger), ...(t.alsoOn ?? [])].join(', ') || '-'}`]);
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

/** Per slot and nested BPMN type, the `<slot>.<key>` keys `set` accepts (id, BPMN attributes, camunda attributes of the descriptor). */
export function nestedKeyTable(): Record<NestedSlot, Record<string, string[]>> {
  const doc = Doc.create();
  const table = {} as Record<NestedSlot, Record<string, string[]>>;
  for (const slot of NESTED_SLOTS) {
    table[slot] = {};
    for (const type of NESTED_TYPES[slot]) table[slot][type] = nestedKeysOf(doc, slot, doc.moddle.create(type));
  }
  return table;
}

/** Selectors for one of several event definitions of an event (`set`, `ext`, ops JSON). */
export const NESTED_SELECTORS: Record<string, string> = {
  'definition[<n>].<key>': 'one of several event definitions of an event, by position (0-based), e.g. \'definition[1].id=Def_Timer\'; plain definition. on such an event is E_AMBIGUOUS_NESTED. `show` and `ext list` name each definition this way; `ext` takes the same prefix (\'definition[0].camunda:field\').',
  'definition[<trigger>].<key>': 'the same by trigger, e.g. \'definition[message].camunda:type=external\' (when the event has one definition of that trigger). Quote the brackets in a shell. `set <id> trigger=<t>` keeps only that definition.',
};

function nestedKeysSection(): string {
  const out: string[] = [heading('NESTED KEYS  (set keys of nested elements without an id: definition. = event definition, loop. = loop characteristics, condition. = condition expression; every slot also takes <slot>.id)')];
  const keyTable = nestedKeyTable();
  const rows: string[][] = [];
  for (const slot of NESTED_SLOTS) {
    for (const [type, keys] of Object.entries(keyTable[slot])) {
      const shown = keys.filter((k) => k !== `${slot}.id`);
      if (shown.length) rows.push([type.replace('bpmn:', ''), shown.join(', ')]);
    }
  }
  out.push(table(rows));
  out.push('  A camunda attribute that belongs on a nested element is refused on its parent (E_WRONG_HOST, the hint names the key).');
  for (const [selector, text] of Object.entries(NESTED_SELECTORS)) out.push(`  ${selector}: ${text}`);
  out.push('  Extension elements of a nested element: the same prefix on the ext type, e.g. `bpmn ext add <file> <id> loop.camunda:failedJobRetryTimeCycle --body R3/PT5M`.');
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
  return [kindsSection(), triggersSection(), setKeysSection(), nestedKeysSection(), placementSection(), errorsSection()].join('\n') + '\n';
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
          ...(t.alsoOn ? { alsoOn: t.alsoOn } : {}),
        },
      ]),
    ),
    nonInterrupting: NON_INTERRUPTING_DOC,
    setKeys: SET_KEYS,
    nestedKeys: nestedKeyTable(),
    nestedSelectors: NESTED_SELECTORS,
    placement: {
      options: PLACEMENT_DOCS,
      notes: PLACEMENT_NOTES,
    },
    ops: OPS_SCHEMA,
    opsExample: opsExample(),
    layoutModes: [...LAYOUT_MODES],
    ids: ID_CONVENTIONS,
    profiles: PROFILE_DOCS,
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
  out.push(`(\`bpmn guide --short\`: the core in 5 KB; \`bpmn guide <topic>\`: one section; topics: ${Object.keys(GUIDE_TOPICS).join(', ')})`);
  out.push(heading('CONTRACT'));
  out.push(
    [
      '  - You edit the metamodel: kinds, names, flows, triggers, lanes, pools, properties, extensions.',
      '  - You never see or write DI (shapes, edges, coordinates). The CLI keeps the drawing: a hand-made (or formatted)',
      '    diagram stays as it is, new elements are placed locally and only affected flows rerouted; a new file, or a',
      '    drawing the engine made and nobody changed, is redrawn by the built-in engine (see LAYOUT MODES).',
      '  - To change the picture, use the format commands (place, align, color, label, route, space, tidy, order of',
      '    lanes); they name other elements, never coordinates (see FORMATTING WITHOUT XML).',
      '  - Ids follow the file: new ids take the id style the file already uses (Camunda Modeler Activity_0k3x9qa,',
      '    serviceTask_checkStock, Task_check_stock, numbered Task_12, flow_aToB, ...). A new file gets readable',
      '    <Prefix>_<NameSlug> ids (Activity_CheckInvoice, Gateway_InvoiceOk); flows and unnamed elements get a short',
      '    hash of their ends / position (Flow_0k3x9qa): independent edits on two branches of a file do not produce',
      '    the same id (files that number their flows keep numbering). Umlauts become ae oe ue ss.',
      '    Every result names the ids it created; use them in the next command (in `apply`, give an explicit id to an',
      '    element a later op refers to).',
      '  - Sub-processes are drawn expanded by default (`--collapsed` / `set expanded=false` to collapse).',
      '  - Branches: the default flow (else the first outgoing flow) continues straight; the other branches alternate',
      '    below and above it in declaration order (`bpmn order` changes the order, `set <flowId> default=true` the continuation).',
      '  - One diagram root: the collaboration when pools exist, else the single process. Several root processes',
      '    need pools (participants). Complex gateways are not supported (a file with one stays editable;',
      '    retype it to a supported gateway). Errors a file already has never block a write (W_PREEXISTING_ERROR).',
      '  - A write rewrites only the elements it changed: comments, CDATA, attribute and namespace order, indentation',
      '    and incoming/outgoing lists (written only where the file has them) stay as the file had them. A result equal',
      '    to the file is not written ("unchanged: <file>"); a comment next to a removed element is reported in a note.',
    ].join('\n'),
  );
  out.push(heading('WORKFLOW'));
  out.push(
    [
      '  1. bpmn new <file> --name "..."          create (or start from an existing .bpmn)',
      '  2. bpmn show <file>                       read the model in flow order; note the ids (a large model:',
      '                                            show --around <id> / show <id> --context, see READING LARGE MODELS)',
      '  3. bpmn add / connect / set / remove ...  one change per command, or many in one `bpmn apply <file> ops.json`',
      '                                            (the split macro is an apply-only op; there is no split command)',
      '  4. bpmn validate <file>                   new errors block a write anyway; warnings are lint hints',
      '  5. bpmn show <file>                       confirm the result (add --show to any mutating command instead)',
      '  Prefer `apply` for more than two related changes: it is one transaction and one layout pass.',
    ].join('\n'),
  );
  out.push(heading('READING LARGE MODELS  (by id only: names may repeat)'));
  out.push(READING.join('\n'));
  out.push(heading('LAYOUT MODES  (every mutating command: --layout <auto|incremental|full>, --relayout, --no-layout)'));
  out.push(
    [
      '  auto (default)  no diagram yet, or the drawing is exactly what the engine would draw (nobody changed it):',
      '                  redraw in full. Otherwise keep it: new elements are placed next to their neighbours, room is',
      '                  made like the modeler\'s space tool, only affected flows are rerouted, removed elements\' DI pruned.',
      '  incremental     always keep the drawing (fails with E_LAYOUT_INCREMENTAL instead of redrawing).',
      '  full            always redraw (= --relayout; also `bpmn layout <file>`). Colours and DI ids survive, positions do not.',
      '  design-iq stickies (bpmiq:sticky) move with the flow node nearest to them, never when no node moved.',
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
      '    bpmn color f.bpmn Activity_A Flow_0k3x9qa Activity_B --color red    a path in red (default removes)',
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
  out.push(heading('CAMUNDA 7  (also CIB seven and Operaton: the camunda: namespace)'));
  out.push(
    [
      '  bpmn new f.bpmn --name "Order" --target camunda7     camunda + modeler namespaces, historyTimeToLive=180, platform 7.24.0',
      '  Attributes: `set` (or `add ... key=value`) with the camunda: prefix; elements without an id take a prefix:',
      '    bpmn set f.bpmn Activity_Charge camunda:type=external camunda:topic=charge-card              external task',
      '    bpmn set f.bpmn Activity_Review camunda:candidateGroups=sales camunda:formKey=embedded:app:forms/review.html',
      "    bpmn set f.bpmn Activity_Review 'loop.camunda:collection=${items}' loop.camunda:elementVariable=item   collection multi-instance",
      '    bpmn set f.bpmn Event_Declined definition.camunda:errorCodeVariable=code                      on the event definition',
      '    bpmn set f.bpmn Flow_Yes condition.camunda:resource=deployment://check.groovy language=groovy  script resource condition',
      '  Extension elements: `ext add`; child types are filed into their container, single containers merged:',
      "    bpmn ext add f.bpmn Activity_Charge camunda:inputParameter name=amount --body '${order.total}'",
      "    bpmn ext add f.bpmn Activity_Charge camunda:errorEventDefinition id=Map_Declined errorRef=Error_Declined 'expression=${declined}'",
      '    bpmn ext add f.bpmn Activity_Call camunda:in variables=all',
      '    bpmn ext add f.bpmn Activity_Review loop.camunda:failedJobRetryTimeCycle --body R3/PT5M',
      "    bpmn ext remove f.bpmn Activity_Charge 'camunda:inputParameter[name=amount]'",
      '  A camunda attribute on the wrong element is refused (E_WRONG_HOST, the hint names the right key).',
      "  One of several event definitions of an event: 'definition[1].<key>=...' or 'definition[timer].<key>=...' (plain",
      '  definition. is E_AMBIGUOUS_NESTED); the engines act on one of them only, set trigger=<t> keeps that one.',
      "  Back from a script resource to an inline condition, in one command: condition.camunda:resource= 'condition=${ok}'.",
      '  Before deploying: `bpmn validate f.bpmn`; fix every W_C7_DEPLOY_* finding (the engines refuse the file), e.g.',
      '  `bpmn set f.bpmn <processId> camunda:historyTimeToLive=180`. Every write reports only the C7 findings it introduced.',
      '  Operaton files (operaton: namespace) work the same with the operaton: prefix; Operaton reads operaton:* first,',
      '  camunda:* as the fallback, Camunda 7 and CIB seven ignore operaton:* (validate says so in its platform line).',
    ].join('\n'),
  );
  out.push(heading('CAMUNDA 8  (the zeebe: namespace)'));
  out.push(CAMUNDA8.join('\n'));
  out.push(heading('DESIGN-IQ  (content repositories with a bpmiq.yml; --profile design anywhere)'));
  out.push(
    [
      '  Inside a design-iq content repository every write checks its result against design-iq\'s save gate (the design',
      '  profile; `validator design` in the result). A change that introduces an E_DESIGN_* error is refused, like the',
      '  live host refuses the save: exactly one start event per process, every node with an incoming and an outgoing',
      '  sequence flow (boundary events too; compensation, link events and ad-hoc content cannot be saved there), every',
      '  node in a top-level lane when the process has lanes, a shape for every element. So build paths in one go:',
      "    echo '[{\"op\":\"add\",\"kind\":\"userTask\",\"name\":\"Review\",\"after\":\"Activity_Check\"}]' | bpmn apply f.bpmn -",
      '    bpmn add f.bpmn boundary:timer "2 days" --on Activity_Review --timer PT2D    refused: the boundary event has no path',
      '    -> one transaction: the boundary event and `{"op":"add","kind":"end","name":"Escalated","after":"Event_2Days"}`',
      '  Links: a call activity names the process it calls (`set <id> calledElement=<file stem>`), a business rule task',
      '  its decision (`set <id> calledDecision=<file stem of the .dmn>`; written as calledDecision= in a design model,',
      '  camunda:decisionRef in Camunda 7, zeebe:calledDecision in Camunda 8). `bpmn validate f.bpmn` lists everything;',
      '  `--profile none` drafts without the gate, `--profile design` applies it outside a content repository.',
    ].join('\n'),
  );
  out.push(heading('OUTPUT  (results, warnings, JSON, stdin / stdout)'));
  out.push(OUTPUT.join('\n'));
  out.push(heading('COMMANDS'));
  for (const c of COMMANDS) {
    out.push(`\n  ${c.usage}`);
    out.push(`      ${c.summary}`);
    for (const ex of c.examples) out.push(`      $ ${ex}`);
  }
  out.push('\n  Common options of every mutating command:');
  out.push(table(COMMON_OPTIONS.map((o) => [o.option, o.description]), '      '));
  out.push('\n  Result (text): one line per created/changed/removed element, then notes, the warnings the change added (see');
  out.push('  OUTPUT), "layout: ok - <full|incremental> (<reason>)" or "layout: skipped", the ids the layout placed / moved / rerouted /');
  out.push('  pruned, one "format <op> #<index>: moved ...; rerouted ...; colored ..." line per format op, "layout quality:');
  out.push('  score <before> -> <after>; added: <kind> [ids]; resolved: ...", then "written: <file>" ("dry run: <file> not written";');
  out.push('  "unchanged: <file> (the result equals the file; nothing written)" when the change left the file as it was).');
  out.push('  With --json: {ok, file, written, unchanged, created, changed, removed, warnings: {added, resolved, preexistingCount},');
  out.push('  notes, layout: {status, mode, reason, warnings, expanded, placed?, moved?, rerouted?, pruned?, notes?, format?: [{op,');
  out.push('  index, moved, rerouted, colored?, labels?, notes?}], metrics: {before?, after: {counts, score}, added, resolved}},');
  out.push('  validation: {errors, platform?, validators?: [{name, detail?, errors, warnings, preexisting, resolved, counts}]},');
  out.push('  importWarnings, view?}. With --summary --json: {ok, file, written, unchanged, created: {<kind>: [ids]}, changed, removed,');
  out.push('  forced?, warnings: {added, resolvedCount, preexistingCount}, layout: {status, mode?, score?: {before?, after}, added?}}.');
  out.push('  A validator\'s findings (the design profile) carry `validator` and `severity`; in text they read "[design] E_...".');
  out.push('  Errors go to stderr as "error E_CODE: message" + "  hint: ..." (+ candidates); with --json as');
  out.push('  {ok: false, error: {code, message, element?, related?, candidates?, hint?, op?}}.');
  out.push(placementSection());
  out.push(triggersSection());
  out.push(opsSection());
  out.push(exitCodesSection());
  out.push(heading('COMMON ERRORS'));
  const common = ['E_NOT_FOUND', 'E_HAS_SUCCESSOR', 'E_AMBIGUOUS_SCOPE', 'E_CROSS_SCOPE', 'E_INVALID_PLACEMENT', 'E_TRIGGER_REQUIRED', 'E_UNKNOWN_KEY', 'E_WRONG_HOST', 'E_DUPLICATE_EXTENSION', 'E_VALIDATION', 'E_DESIGN_*', 'E_IMPORT_LOSSY', 'E_USAGE', 'E_LEAVES_CONTAINER', 'E_NO_ROOM'];
  for (const code of common) {
    const e = ERROR_CATALOGUE.find((d) => d.code === code);
    if (e) out.push(`  ${e.code}: ${e.meaning}\n      fix: ${e.fix}`);
  }
  out.push('  The full catalogue: `bpmn kinds` (section ERRORS AND WARNINGS) or `bpmn kinds --json` -> errors.');
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* the short guide and the topics                                       */
/* ------------------------------------------------------------------ */

/** READING LARGE MODELS: the views an agent reads a large model with. */
const READING = [
  '  bpmn show <file> --around <id> [--depth 2] [--inner]   the neighbourhood of one element: --depth flow steps along',
  '      sequence flows both ways (boundary events and their hosts are neighbours; the first / last node of a sub-process',
  '      leads out to it, --inner also leads into sub-processes); per node its lane, implementation (vendor values,',
  '      `io: in a; out b`, zeebe:taskDefinition type=...) and flows, `<- Src (Flow)` for a flow from outside the window;',
  '      the header counts what was left out; message flows, annotations and data of the window follow.',
  '  bpmn show <file> <id> --context   the element in its context: `in:` pool > process > sub-processes, `lane:` (also',
  '      inherited through sub-processes), `from:` / `to:` with names and flows, its boundary events, `caught by:` the',
  '      error / escalation boundary events of the sub-processes around it, the event sub-processes around it,',
  '      annotations, message flows with the partner and its pool, data it reads / writes, its implementation.',
  '  bpmn show <file> <id>             every detail of one element (properties, extension tree, message flows, data)',
  '  bpmn find <file> <text> [--kind k]   ids by id, name or vendor value (topic, assignee, ...)',
  '  bpmn show <file> [--scope <id>]   the whole model (lane=<id> per node), or one process / pool / sub-process',
  '  For a local edit read --around first; "what happens if X fails" / "who does X" is one --context call.',
];

/** CAMUNDA 8: zeebe extension elements in practice. */
const CAMUNDA8 = [
  '  bpmn new f.bpmn --name "Order" --target camunda8     zeebe + modeler namespaces (executionPlatform Camunda Cloud)',
  '  The implementation lives in zeebe extension elements (`ext add`); child types go into their container, single',
  '  elements are merged, an item with the same key (zeebe:input / output target, zeebe:header key) replaces the old one:',
  '    bpmn ext add f.bpmn Activity_Charge zeebe:taskDefinition type=charge-card retries=3          job worker type',
  "    bpmn ext add f.bpmn Activity_Charge zeebe:input source='=order.total' target=amount           -> zeebe:ioMapping",
  "    bpmn ext add f.bpmn Activity_Charge zeebe:output source='=receipt' target=receipt",
  '    bpmn ext add f.bpmn Activity_Charge zeebe:header key=channel value=web                         -> zeebe:taskHeaders',
  '    bpmn ext add f.bpmn Activity_Bill zeebe:calledElement processId=billing                        call activity',
  '    bpmn ext add f.bpmn Activity_Review zeebe:assignmentDefinition candidateGroups=sales',
  '    bpmn set f.bpmn Activity_Rate calledDecision=risk-rating      zeebe:calledDecision decisionId (business rule task)',
  '  `bpmn ext list f.bpmn <id>` shows the tree; `show --around` / `show <id> --context` show the implementation in one',
  '  line (zeebe:taskDefinition type=charge-card retries=3, io: in amount; out receipt). `bpmn validate`: structure and',
  '  lint only (no Camunda 8 engine rules yet).',
];

/** OUTPUT: what a result reports, JSON, stdin / stdout. */
const OUTPUT = [
  '  A mutating command reports what changed, the warnings the change ADDED (three or more of one code as one line:',
  '  `warning W_UNREACHABLE x20 [ids]: ...`), `resolved:` what it fixed, and one line counting the warnings the file',
  '  already had (not repeated: `bpmn validate <file>` lists them); then the layout block and the file line.',
  '  --summary: `created <kind>: ids` per kind, `changed:` / `removed:` ids, the added warnings, one `warnings:` count line',
  '  and one layout line (`layout: incremental, score 12 -> 14; added: crossings [Flow_1, Flow_3]`).',
  '  --json is compact (one line; --pretty indents it): warnings: {added, resolved, preexistingCount}; with --summary the',
  '  summary as JSON. Errors go to stderr (`error E_CODE: message` + hint; with --json one JSON line).',
  '  stdin / stdout: `-` as the file reads the model from stdin: show -, find - <text>, validate -, metrics -,',
  '  ext list - <id>; a mutating command on `-` (add -, apply - ops.json, layout -, ...) writes the result to stdout.',
  '  `-o -` writes the result of any mutating command to stdout. With the XML on stdout the report goes to stderr.',
];

/** The errors the short guide lists, each with a one-line fix (the catalogue has the full text). */
const TOP_ERRORS: Array<[string, string]> = [
  ['E_NOT_FOUND', 'use a listed candidate id; `bpmn find <file> <text>` lists ids'],
  ['E_HAS_SUCCESSOR', 'several outgoing flows: --flow <flowId> or --after X --before Y'],
  ['E_AMBIGUOUS_SCOPE', 'several processes: add --in <processId|participantId>'],
  ['E_INVALID_PLACEMENT', 'boundary events --on <activity>; data, annotations, lanes, pools --in only'],
  ['E_CROSS_SCOPE', 'sequence flows stay in one scope; between pools `connect` makes a message flow'],
  ['E_UNKNOWN_KEY', 'the message lists the settable keys; vendor keys need a prefix (camunda:assignee)'],
  ['E_VALIDATION', 'the change would add a structural error: do it in one `apply` batch, or `bpmn validate`'],
  ['E_LEAVES_CONTAINER', 'move --lane first, then place'],
  ['E_NO_ROOM', 'make room with `bpmn space --after|--below <id>`, then place again'],
];

/** Every op with its keys (`*` = required); add / retype fold their trigger keys into `<trigger keys>`. */
function opKeyLines(): string[] {
  const triggerKeys = new Set([...TRIGGER_OPTIONS.flatMap((t) => t.keys), 'nonInterrupting']);
  return OP_NAMES.map((n) => {
    const fields = Object.entries(OP_FIELDS[n]);
    // an op with the whole set of trigger options (add, retype) shows them as one item
    const folds = fields.filter(([k]) => triggerKeys.has(k)).length > 3;
    const keys = fields.filter(([k]) => !folds || !triggerKeys.has(k)).map(([k, spec]) => (spec.required ? `${k}*` : k));
    if (folds) keys.push('<trigger keys>');
    return `  ${n.padEnd(8)} ${keys.join(' ')}`;
  });
}

/** `bpmn guide --short`: contract, reading, changing, ops keys, placement and the top errors in at most 5 KB. */
export function guideShort(): string {
  const out: string[] = [];
  out.push('bpmn — edit BPMN 2.0 models semantically (short guide; `bpmn guide <topic>` for one section, `bpmn guide` for all)');
  out.push(heading('CONTRACT'));
  out.push(
    [
      '  - You edit the model (kinds, names, flows, triggers, lanes, pools, properties, extensions), never the diagram: a',
      '    hand-made drawing is kept and changes are placed locally; a new file is drawn for you.',
      '  - Elements are addressed by id only (names may repeat). New ids follow the file\'s id conventions; an explicit id',
      '    (--id, "id") always wins; every result names the ids it created.',
      '  - Errors the file already had never block a write; a change that would add one is refused (E_VALIDATION).',
    ].join('\n'),
  );
  out.push(heading('READ'));
  out.push(
    [
      '  bpmn show <f> --around <id> [--depth 2]   neighbourhood: lanes, implementation, flows (cheap)',
      '  bpmn show <f> <id> --context             where it is, lane, before / after, what catches it, message flows',
      '  bpmn find <f> <text> [--kind <kind>]     ids by name or vendor value',
      '  bpmn show <f> [--scope <id>]             the whole model (or one process / pool / sub-process)',
    ].join('\n'),
  );
  out.push(heading('CHANGE'));
  out.push(
    [
      '  bpmn add <f> <kind[:trigger]> [name] [--after|--before|--flow|--in|--on <id>] [--id <id>] [key=value ...]',
      '  bpmn connect|set|remove|retype|move|order|ext ...     bpmn apply <f> ops.json   (one transaction, one layout)',
      '  Options: --summary (short result), --dry-run, -o <file|->, --json [--pretty]; `-` as <f> reads stdin.',
    ].join('\n'),
  );
  out.push(heading('OPS JSON  (bpmn apply; {"op": "<name>", ...}; * = required)'));
  out.push(opKeyLines().join('\n'));
  out.push(heading('PLACEMENT'));
  out.push(
    [
      '  --after X     append after a gateway / end of a path, else splice into X\'s single outgoing flow',
      '  --before Y    prepend before a join / start of a path, else splice into Y\'s single incoming flow',
      '  --flow F      splice into flow F (F keeps id, name, condition)     --after X --before Y: into the flow X -> Y',
      '  --in S        unconnected in process / sub-process / pool S       --on A: boundary event on activity A',
      '  --to T        also connect the new node to T',
    ].join('\n'),
  );
  out.push(heading('TOP ERRORS'));
  out.push(table(TOP_ERRORS.map(([code, fix]) => [code, fix])));
  out.push(`\nTopics (bpmn guide <topic>): ${Object.keys(GUIDE_TOPICS).join(', ')}. All codes: bpmn kinds --section errors.`);
  return out.join('\n') + '\n';
}

/** The topics of `bpmn guide <topic>`: the sections of the full guide they print (by heading). */
export const GUIDE_TOPICS: Record<string, { sections: string[]; summary: string }> = {
  contract: { sections: ['CONTRACT'], summary: 'what the CLI does and keeps' },
  workflow: { sections: ['WORKFLOW'], summary: 'the edit loop' },
  reading: { sections: ['READING LARGE MODELS'], summary: 'show --around, --context, find' },
  output: { sections: ['OUTPUT'], summary: 'results, warnings delta, --summary, JSON, stdin / stdout' },
  layout: { sections: ['LAYOUT MODES'], summary: 'auto / incremental / full' },
  format: { sections: ['FORMATTING WITHOUT XML'], summary: 'place, align, color, label, route, space, tidy' },
  ops: { sections: ['OPS JSON'], summary: 'apply and its ops' },
  placement: { sections: ['PLACEMENT'], summary: '--after / --before / --flow / --in / --on' },
  triggers: { sections: ['TRIGGERS'], summary: 'event triggers and their options' },
  errors: { sections: ['COMMON ERRORS', 'EXIT CODES'], summary: 'the common errors and the exit codes' },
  quoting: { sections: ['QUOTING'], summary: 'shell quoting of expressions' },
  camunda7: { sections: ['CAMUNDA 7'], summary: 'camunda: attributes, extensions, the deploy profile' },
  camunda8: { sections: ['CAMUNDA 8'], summary: 'zeebe: extension elements' },
  design: { sections: ['DESIGN-IQ'], summary: 'the design profile (save gate)' },
  commands: { sections: ['COMMANDS'], summary: 'every command with examples' },
};

/** The guide's sections by heading (a heading is a line underlined with dashes). */
function guideSections(): Array<{ title: string; text: string }> {
  const lines = guideText().split('\n');
  const out: Array<{ title: string; text: string }> = [];
  let current: { title: string; lines: string[] } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (next !== undefined && line.length > 0 && /^-+$/.test(next) && next.length === line.length) {
      if (current) out.push({ title: current.title, text: current.lines.join('\n').trimEnd() });
      current = { title: line, lines: [line, next] };
      i++;
      continue;
    }
    current?.lines.push(line);
  }
  if (current) out.push({ title: current.title, text: current.lines.join('\n').trimEnd() });
  return out;
}

/** `bpmn guide <topic>`: the sections of the full guide a topic names; E_USAGE with the topics for an unknown one. */
export function guideTopic(topic: string): string {
  const key = topic.trim().toLowerCase().replace(/[\s_-]/g, '');
  const entry = Object.entries(GUIDE_TOPICS).find(([name]) => name === key);
  if (!entry) {
    const names = Object.keys(GUIDE_TOPICS);
    throw usageError(`Unknown guide topic "${topic}"`, { candidates: names, hint: 'Pass one of the listed topics, or `bpmn guide --short` for the core.' });
  }
  const sections = guideSections();
  const parts = entry[1].sections.map((title) => sections.find((s) => s.title.startsWith(title))?.text ?? '');
  return parts.filter(Boolean).join('\n\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* kinds --section                                                      */
/* ------------------------------------------------------------------ */

function simpleRows(title: string, rows: string[][]): string {
  return [heading(title), table(rows)].join('\n');
}

/** The parts of `bpmn kinds` / `kinds --json` by their JSON key; text renders the matching section. */
const KINDS_SECTIONS: Record<string, { text: () => string; keys: string[] }> = {
  kinds: { text: kindsSection, keys: ['kinds'] },
  triggers: { text: triggersSection, keys: ['triggers', 'nonInterrupting'] },
  setKeys: { text: setKeysSection, keys: ['setKeys'] },
  nestedKeys: { text: nestedKeysSection, keys: ['nestedKeys', 'nestedSelectors'] },
  placement: { text: placementSection, keys: ['placement'] },
  ops: { text: opsSection, keys: ['ops', 'opsExample'] },
  layoutModes: { text: () => simpleRows('LAYOUT MODES', LAYOUT_MODES.map((m) => [m])), keys: ['layoutModes'] },
  ids: { text: () => [heading('IDS'), JSON.stringify(ID_CONVENTIONS, null, 2)].join('\n'), keys: ['ids'] },
  profiles: { text: () => simpleRows('PROFILES', PROFILE_DOCS.map((p) => [p.profile, p.description])), keys: ['profiles'] },
  colors: { text: () => simpleRows('COLORS', Object.entries(SWATCHES).map(([name, c]) => [name, JSON.stringify(c)])), keys: ['colors'] },
  errors: { text: errorsSection, keys: ['errors'] },
  exitCodes: { text: exitCodesSection, keys: ['exitCodes'] },
};

/** The section names `kinds --section` accepts (the JSON keys of `kinds --json`). */
export const KINDS_SECTION_NAMES = Object.keys(KINDS_SECTIONS).join(', ');

/** Resolves `--section a,b` (case and dashes ignored: set-keys = setKeys); E_USAGE with the names for an unknown one. */
export function kindsSections(spec: string): string[] {
  const names = Object.keys(KINDS_SECTIONS);
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const key = raw.toLowerCase().replace(/[\s_-]/g, '');
      const found = names.find((n) => n.toLowerCase() === key) ?? names.find((n) => n.toLowerCase() === key.replace(/s$/, '')) ?? names.find((n) => KINDS_SECTIONS[n]!.keys.some((k) => k.toLowerCase() === key));
      if (!found) throw usageError(`Unknown kinds section "${raw}"`, { candidates: names, hint: `Sections: ${names.join(', ')} (several: --section ops,errors).` });
      return found;
    });
}

/** `bpmn kinds --section <names>` as text. */
export function kindsSectionText(sections: string[]): string {
  return sections.map((s) => KINDS_SECTIONS[s]!.text()).join('\n').replace(/^\n/, '') + '\n';
}

/** `bpmn kinds --section <names> --json`: only those keys of kindsJson(). */
export function kindsSectionJson(sections: string[]): Record<string, unknown> {
  const all = kindsJson();
  const out: Record<string, unknown> = {};
  for (const s of sections) for (const k of KINDS_SECTIONS[s]!.keys) out[k] = all[k];
  return out;
}

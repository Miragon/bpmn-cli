import { OP_FIELDS } from '../ops/batch.js';
import { OP_NAMES } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
import { COMMANDS, COMMON_OPTIONS } from './CommandCatalogue.js';
import { COMMON_ERRORS, ERROR_CATALOGUE, TOP_ERRORS, TRIGGER_OPTIONS } from './guide.js';
import { KindsReference } from './KindsReference.js';
import { heading, table } from './utils/table.js';

/** READING LARGE MODELS: the views an agent reads a large model with. */
const READING = [
  '  bpmn show <file> --around <id> [--depth 2] [--inner]   the neighbourhood of one element: --depth flow steps along',
  '      sequence flows both ways (boundary events and their hosts are neighbours; the first / last node of a sub-process',
  '      leads out to it, --inner also leads into sub-processes); per node its lane, implementation (vendor values,',
  '      `io: in a; out b`, zeebe:taskDefinition type=...) and flows, `<- Src (Flow)` for a flow from outside the window;',
  '      the header counts what was left out; message flows, annotations and data of the window follow.',
  '  bpmn show <file> <id> --context   the element in its context: `in:` pool > process > sub-processes, `lane:` (also',
  '      inherited through sub-processes), `from:` / `to:` with names and flows, its boundary events, `caught by:` every',
  '      boundary event of the sub-processes around it (interrupting ones cancel it; non-interrupting marked), the event',
  '      sub-processes around it, annotations, message flows with the partner and its pool, data it reads / writes, its',
  '      implementation; a message element its `message:` (id, name, correlation key) and the flows of that message drawn',
  '      to its pool `(at pool P)`; a message flow its ends with their pools; a message / signal / error `used by:`.',
  '  bpmn show <file> <id>             every detail of one element (properties, extension tree, message flows, data)',
  '  bpmn find <file> <text> [--kind k]   ids by id, name or vendor value (topic, assignee, ...)',
  '  bpmn show <file> [--scope <id>]   the whole model (lane=<id> per node), or one process / pool / sub-process',
  '  For a local edit read --around first; "what happens if X fails" / "who does X" is one --context call.',
];

/** LOOKING AT THE DRAWING: bpmn render for agents. */
const LOOKING = [
  '  bpmn render <file> --problems -o f.png        the whole plane; every layout problem of `bpmn metrics` as a numbered',
  '                                                 badge on the defect, listed below the result line with its ids:',
  '                                                   1 crossings [Flow_6, Flow_21]',
  '  bpmn render <file> --around <id> [--depth 2] [--inner]   exactly the nodes of `show --around` (cheap: a few',
  '                                                 hundred image tokens), their flows, data and annotations',
  '  bpmn render <file> --path <from> <to> [--via <flowId>]   the nodes and flows of that sequence-flow path',
  '  bpmn render <file> --scope <pool|lane|subProcess>       one pool, lane or sub-process with its content',
  '  bpmn render <file> <id> <id> ...               exactly these elements',
  '  A crop draws flows to what it leaves out faded, pools and lanes as context; with --problems it lists the',
  '  problems of its elements. --highlight <id,...> puts an orange halo around elements. --tiles splits an image',
  '  whose labels would be too small (scale below 0.75) at the diagram columns into readable tiles (-1.png, ...);',
  '  only tiles with a shape, label or numbered problem are written (at most 40; more: render a part).',
  '  Budget: the result line says the image tokens (width * height / 784); the long edge stays within --max-size',
  '  (2000). On a large model render a crop, not the whole plane.',
  '  After a change: add --render <f.png> to the mutating command (or `apply`): created elements green, changed',
  '  orange, moved blue, the layout problems the change added numbered (a large drawing: the region of the change).',
  '  Fix what you see with the format commands (label, place, route, space, tidy) by the ids of the legend, then',
  '  look again; stop after two rounds.',
];

/** CAMUNDA 8: zeebe extension elements in practice. */
const CAMUNDA8 = [
  '  bpmn new f.bpmn --name "Order" --target camunda8     zeebe + modeler namespaces, platform Camunda Cloud 8.9.0',
  '  Camunda 8 settings are extension elements (`bpmn kinds --section zeebeElements` lists them per kind): child types go',
  '  into their container, single elements are merged, an item with the same key (zeebe:input / output target,',
  '  zeebe:header key) replaces the old one. FEEL values start with = (write attr==<expression>: the first = separates',
  '  key and value):',
  '    bpmn ext add f.bpmn Activity_Charge zeebe:taskDefinition type=charge-card retries=3          job worker',
  '    bpmn ext add f.bpmn Activity_Charge zeebe:input source==order.total target=amount            -> zeebe:ioMapping',
  '    bpmn ext add f.bpmn Activity_Charge zeebe:output source==receipt target=receipt',
  '    bpmn ext add f.bpmn Activity_Charge zeebe:header key=channel value=web                       -> zeebe:taskHeaders',
  '    bpmn ext add f.bpmn Activity_Review zeebe:assignmentDefinition candidateGroups=sales assignee==reviewer',
  '    bpmn ext add f.bpmn Activity_Review zeebe:formDefinition formId=review-form                  linked form',
  '    bpmn ext add f.bpmn Activity_Bill zeebe:calledElement processId=billing propagateAllChildVariables=false',
  '    bpmn ext add f.bpmn Activity_Inform loop.zeebe:loopCharacteristics inputCollection==parties inputElement=party',
  '                                                                  (creates the parallel multi-instance loop)',
  '    bpmn set f.bpmn Activity_Wait message=PaymentReceived                                        receive task',
  '    bpmn ext add f.bpmn Message_PaymentReceived zeebe:subscription correlationKey==orderId       message correlation',
  '    bpmn set f.bpmn Activity_Wait zeebe:correlationKey==orderId          the same, on the message Activity_Wait waits for',
  '  A zeebe:subscription (ext add) or zeebe:correlationKey (set) given to a catch event or receive task goes to the',
  '  bpmn:Message it waits for (Camunda 8 reads it there; the result notes it). In `apply`, "refAs": "$msg" names the',
  '  message an op creates or finds: {"op":"add","kind":"receiveTask","name":"Wait","message":"Paid","refAs":"$msg",...},',
  '  then {"op":"ext","id":"$msg","action":"add","type":"zeebe:subscription","attrs":{"correlationKey":"=orderId"}}.',
  '    bpmn set f.bpmn Activity_Rate calledDecision=risk-rating      zeebe:calledDecision decisionId (business rule task)',
  '    bpmn ext add f.bpmn Activity_Rate zeebe:calledDecision resultVariable=risk',
  "    bpmn add f.bpmn userTask \"Approve\" --after Gateway_Big --condition '= amount > 1000' --flow-name yes   FEEL condition",
  "    bpmn ext remove f.bpmn Activity_Charge 'zeebe:input[target=amount]'",
  '  New user tasks of a Camunda 8 file get zeebe:userTask (a Camunda user task, like the Modeler); new event',
  '  definitions an id (Camunda 8.9 refuses conditional, compensation and link catch definitions without one).',
  '  A zeebe attribute that belongs on an extension element is refused (`set X zeebe:assignee=...`: E_WRONG_HOST,',
  '  the hint is the ext add). `bpmn ext list f.bpmn <id>` shows the tree; `show --around` / `show <id> --context` show',
  '  the implementation in one line (zeebe:taskDefinition type=charge-card retries=3, io: in amount; out receipt).',
  '  Before deploying: `bpmn validate f.bpmn`; fix every W_C8_DEPLOY_* finding (Camunda 8 refuses the file: a service',
  '  task without job type, a FEEL syntax error, a message without correlation key, PT2D instead of P2D, PT1.5H (a',
  '  fraction on seconds only), an id with a colon, child elements in an order the BPMN schema does not allow, ...; each',
  '  hint is the command). Runtime findings (W_C8_*) deploy but misbehave: a flow without condition out of an exclusive',
  '  gateway is never taken, camunda:* content is ignored, ...',
];

/** BPMNLINT: the project's .bpmnlintrc in validate and every write (src/validate/bpmnlint-validator.ts, src/node/bpmnlint.ts). */
const BPMNLINT = [
  '  A .bpmnlintrc in the model\'s directory or above, up to the repository root (the directory with .git), runs in',
  '  `bpmn validate` and in every write; --lint-config <path> names another one, --no-lint-config switches it off.',
  '  A write looks it up from the file it writes (-o), a model from stdin without -o from the working directory.',
  '  Outside a git repository only the model\'s own directory counts. Whose repository it is does not matter for the',
  '  lookup (root over another uid\'s checkout in CI, on Windows one outside the home directory: the same .bpmnlintrc);',
  '  only project plugins depend on the owner, see below. No .bpmnlintrc: nothing is loaded. Unlike bpmnlint\'s own',
  '  CLI, which reads the .bpmnlintrc of the working directory, the nearest one above the model wins. A model whose',
  '  directory is reached through a symbolic link: the path as given first, then the physical directory (where git',
  '  finds the repository); a linked model file counts by the directory of the link.',
  '  Findings name the validator, the severity, the rule and the element id (a warning reads `[bpmnlint] <rule>`):',
  '    [bpmnlint error] label-required Activity_Check: Element is missing label/name            (validate)',
  '    warning [bpmnlint error] label-required Activity_Check: Element is missing label/name    (a write)',
  '  validate reports every finding; an error fails the check (exit 2), and three or more of one rule with one hint',
  '  are one line (its most common message with the ids that have it; --json lists every finding). A write lists',
  '  only the findings the change added (three or more of one rule and message as one line; --strict exits 5 on',
  '  them), never refuses because of them, and counts the rest: `validator bpmnlint (.bpmnlintrc in models): 1',
  '  error(s), 10 warning(s) in the result (3 added, 1 resolved, 8 already in the file)`; --summary counts them in its',
  '  `warnings:` line. Fix what the change added in the same batch. In a file without incoming / outgoing lists,',
  '  no-implicit-end, no-implicit-start, no-disconnected and event-based-gateway report nodes that have flows (in CI',
  '  too): validate lists them with a hint, a write never adds or resolves them but counts them (its validator line',
  '  ends with `7 left out (incoming / outgoing lists the file does not keep; ...)`, --summary has a `validator',
  '  bpmnlint:` line), also those of the nodes it added; a node without a flow is reported. Where a rule says what a',
  '  lint warning says (start-event-required: W_NO_START, end-event-required: W_NO_END, no-implicit-end: W_DEAD_END),',
  '  only the bpmnlint finding is listed, with the hint. Its element-id-naming decides the prefix and case of new ids,',
  '  so a write adds no finding of it (see CONVENTIONS).',
  '  A new file from `bpmn new` lists its findings (an empty process: start-event-required, end-event-required).',
  '  Rules: bpmnlint\'s own, camunda-compat\'s and @miragon/rules ship with bpmn-cli (offline, no install). A plugin',
  '  bpmn-cli does not ship runs from the repository\'s node_modules: its code runs (the validator line names it); one',
  '  installed outside the repository is not loaded, nor one outside a git repository of the user running bpmn-cli',
  '  (by the owners of the directory and its .git, not git\'s safe.directory; root: also SUDO_UID\'s; on Windows only',
  '  inside the home directory): W_LINT_UNAVAILABLE says why, and the rest of the .bpmnlintrc runs.',
  '  moddleExtensions: JSON descriptors only; camunda-bpmn-moddle/resources/camunda.json and',
  '  zeebe-bpmn-moddle/resources/zeebe.json work without an install; a descriptor BpmnModdle rejects is left out.',
  '  W_LINT_UNAVAILABLE: something the .bpmnlintrc names is left out (not installed, no such rule, not strict JSON,',
  '  a project plugin outside a git repository of the user, ...); the hint says what to do; a write counts it (its',
  '  validator line: `N left out`). W_LINT_FAILED: a rule threw, its findings are left out; or no rule ran (validate',
  '  and `bpmn new` list it, a later write says `1 left out (W_LINT_FAILED, no rule ran; ...)`). import-warning: an',
  '  error of bpmnlint\'s parse with the moddleExtensions (bpmnlint\'s CLI fails on it too, validate exits 2); the hint',
  '  says what to fix. E_LINT_CONFIG (exit 4): --lint-config names a file that cannot be read or is not strict JSON.',
];

/** CONVENTIONS: the id conventions element-id-naming of the project's .bpmnlintrc declares (src/ids/conventions.ts, src/ids/style.ts). */
const CONVENTIONS = [
  '  A .bpmnlintrc that runs @miragon/rules/element-id-naming (plugin:@miragon/rules/recommended-for-automation and the',
  '  plugin\'s engine defaults turn it on) declares the prefix of each BPMN type, the case of the body and the',
  '  event-definition qualifier. New ids take the declared prefix and case where the rule declares one, so a write adds',
  '  no element-id-naming finding:',
  '    serviceTask_checkInvoice, gateway_approved, event_timer2Days, flow_checkInvoiceToBookInvoice; under camelCase /',
  '    PascalCase a taken id gets a glued 2 (serviceTask_checkInvoice2; after a digit No2: serviceTask_step1No2) and a',
  '    split\'s join is gateway_approvedJoin',
  '  `bpmn show <file> --conventions` lists each pattern with its kinds and where it comes from (lint: the rule, file:',
  '  the file\'s ids, lint shape: shaped like the rule\'s prefixes, default: bpmn-cli\'s; not checked: the rule declares',
  '  nothing for it), also for a file that does not exist yet: run it before the first change. Where none are declared',
  '  it says why (--no-lint-config, no .bpmnlintrc, one that could not be loaded: W_LINT_UNAVAILABLE, the rule off).',
  '  What the rule does not name (lanes, pools, data, messages) follows the file, learned without the ids that already',
  '  follow the rule; a new file takes the rule\'s case and prefix shape (lane_sales). Message flows take the sequence',
  '  flows\' prefix until the file\'s own message flows show a style. The process and the definitions keep',
  '  Process_<Name> / Definitions_<Name> unless the rule names bpmn:Process / bpmn:Definitions (process_main',
  '  without a name); a new pool\'s process takes the prefix two of the file\'s process ids share (process_customer,',
  '  process_shop: process_bankAccount; never the pools\'). eventDefinitionQualifier required: timerStartEvent_...,',
  '  messageEvent_...; optional (the default): the plain prefix. Explicit ids are taken as given (the join of a split',
  '  whose id lacks the declared prefix or case: gateway_checkJoin). Existing ids never change for the conventions:',
  '  after a retype or a trigger change W_ID_PREFIX_STALE names an id whose prefix no longer fits (a batch: from before',
  '  it to after it), with the `bpmn set <file> <id> id=<newId>` that renames it (the new prefix and the rest of the',
  '  id, or the id of what it is now where that rest failed the rule); an element the batch created takes the new',
  '  prefix instead, and the flows named after it follow. In a file with ids of its own the rule rejects, a result',
  '  names the new ids under a prefix the rule declares that differ from the file\'s own style (`conventions: ...',
  '  follow element-id-naming (...)`; JSON: conventions.ids); a new file and one that follows the rule get none.',
  '  W_CONFIG_IGNORED: a value of the rule new ids cannot follow (a prefix that cannot start an id, one for a DI',
  '  type: DI ids follow their element, an unknown case or qualifier); a write only counts it.',
  '  --no-lint-config, no .bpmnlintrc or the rule off: the file\'s style alone.',
];

/** OUTPUT: what a result reports, JSON, stdin / stdout. */
const OUTPUT = [
  '  A mutating command reports what changed, the warnings the change ADDED (three or more of one code as one line:',
  '  `warning W_UNREACHABLE x20 [ids]: ...`; W_FLOW_ID_STALE keeps one line each), `resolved:` what it fixed, and one',
  '  line counting the warnings the file already had (the platform profile\'s W_C7_* / W_C8_* among them; not repeated:',
  '  `bpmn validate <file>` lists them); then the layout block and the file line. A group warning (W_DUPLICATE_NAME)',
  '  that only shrank is the old one; an apply batch reports the warnings of its final state. The project\'s bpmnlint',
  '  (see BPMNLINT) is advisory: an error of it the change added is listed among the warnings',
  '  (`warning [bpmnlint error] <rule> <id>: ...`). `conventions:` names the new ids under a prefix its',
  '  element-id-naming declares, where they differ from the file\'s own style (see CONVENTIONS). Where',
  '  BPMN_KEEP_FLOW_IDS=1 kept the flow ids (no --keep-flow-ids / --no-keep-flow-ids given) and that changed the',
  '  result (W_FLOW_ID_STALE, or a move put the node\'s old out-flow back), it says so, also with --summary:',
  '  `note: flow ids kept: BPMN_KEEP_FLOW_IDS=1 (...)` (JSON: notes); an E_NOT_FOUND of an apply batch, in its hint.',
  '  --summary: `created <kind>: ids` per kind, `aliases:` (apply), `changed:`, `renamed: <old> -> <new>` (a flow whose id',
  '  named its old ends: use the new id; with --keep-flow-ids it keeps its id and W_FLOW_ID_STALE names it) and',
  '  `removed:` ids, one `format <op> #<i>: ...` line per format op, the added warnings, one `warnings:` count line (what',
  '  is already in the file includes the project\'s bpmnlint findings) and',
  '  one layout line (`layout: incremental, score 12 -> 14; added: crossings [Flow_AToB, Flow_CToD]`).',
  '  --json is compact (one line; --pretty indents it): warnings: {added, resolved, preexistingCount}; with --summary the',
  '  summary as JSON. Errors go to stderr (`error E_CODE: message` + hint; with --json one JSON line).',
  '  stdin / stdout: `-` as the file reads the model from stdin: show -, find - <text>, validate -, metrics -,',
  '  render -, ext list - <id>; a mutating command on `-` (add -, apply - ops.json, layout -, ...) writes the result to',
  '  stdout. `-o -` writes the result of any mutating command (and the image of render) to stdout. With the XML or',
  '  the image on stdout the report goes to stderr.',
];

/** Keys the short guide leaves out: `bpmn guide ops` and the schema list them (outAs, the flow an add creates out of the node: for a rare batch, not worth the short guide's bytes). */
const FULL_GUIDE_ONLY_KEYS: ReadonlySet<string> = new Set(['outAs']);

/** The topics of `bpmn guide <topic>`: the sections of the full guide they print (by heading). */
export const GUIDE_TOPICS: Record<string, { sections: string[]; summary: string }> = {
  contract: { sections: ['CONTRACT'], summary: 'what the CLI does and keeps' },
  workflow: { sections: ['WORKFLOW'], summary: 'the edit loop' },
  reading: { sections: ['READING LARGE MODELS'], summary: 'show --around, --context, find' },
  output: { sections: ['OUTPUT'], summary: 'results, warnings delta, --summary, JSON, stdin / stdout' },
  layout: { sections: ['LAYOUT MODES'], summary: 'auto / incremental / full' },
  format: { sections: ['FORMATTING WITHOUT XML'], summary: 'place, align, color, label, route, space, tidy' },
  render: { sections: ['LOOKING AT THE DRAWING'], summary: 'bpmn render: crops, halos, numbered problems, tiles, --render' },
  ops: { sections: ['OPS JSON'], summary: 'apply and its ops' },
  placement: { sections: ['PLACEMENT'], summary: '--after / --before / --flow / --in / --on' },
  triggers: { sections: ['TRIGGERS'], summary: 'event triggers and their options' },
  errors: { sections: ['COMMON ERRORS', 'EXIT CODES'], summary: 'the common errors and the exit codes' },
  quoting: { sections: ['QUOTING'], summary: 'shell quoting of expressions' },
  camunda7: { sections: ['CAMUNDA 7'], summary: 'camunda: attributes, extensions, the deploy profile' },
  camunda8: { sections: ['CAMUNDA 8'], summary: 'zeebe: extension elements, the Camunda 8 profile' },
  bpmnlint: { sections: ['BPMNLINT'], summary: "the project's .bpmnlintrc in validate and writes" },
  conventions: { sections: ['CONVENTIONS'], summary: 'the id conventions of the .bpmnlintrc (element-id-naming)' },
  commands: { sections: ['COMMANDS'], summary: 'every command with examples' },
};

export class AgentGuide {
  constructor(private readonly kinds = new KindsReference()) {}

  /** `bpmn guide`: the agent cheat sheet. */
  text(): string {
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
        '  - To change the picture, use the format commands (place, align, color, label, route, space, tidy, compact,',
        '    order of lanes and pools); they name other elements, never coordinates (see FORMATTING WITHOUT XML).',
        '  - Elements are addressed by id only (names may repeat). Ids speak and follow the file: a new id says what it',
        '    names (Activity_CheckInvoice; unnamed: kind + place, Gateway_AfterCheckInvoice, Event_TimerOnReview; flows',
        '    their ends, Flow_CheckInvoiceToBookInvoice) with the file\'s prefixes, case and flow form (serviceTask_checkStock,',
        '    Task_check_stock, flow_aToB; a Camunda Modeler file of Activity_0k3x9qa gets Activity_CheckInvoice). Never a',
        '    hash or a running number; umlauts become ae oe ue ss (ø oe, å aa); at most 64 characters, cut at whole words; a',
        '    taken id gets _2 (W_ID_SUFFIXED; an unnamed gateway or task says its kind first, Gateway_ParallelAfterCheck,',
        '    then the unnamed anchor it follows, Task_AfterCheckGateway). Where the .bpmnlintrc\'s element-id-naming',
        '    declares a prefix, it and the declared case decide instead (serviceTask_checkInvoice; see CONVENTIONS).',
        '    A flow names an unnamed gateway by its id (Flow_CheckToAfterCheck). A flow whose id names its ends is',
        '    renamed when a splice or bridge changes them (the result says so). Where flow ids are API (generated code,',
        '    process tests), --keep-flow-ids or BPMN_KEEP_FLOW_IDS=1 keeps them; W_FLOW_ID_STALE then names each flow',
        '    whose id no longer names its ends, with the `bpmn set` that renames it.',
        '    Every result names the ids it created; use them in the next command. In `apply`, name what an op creates',
        '    with an alias ("as": "$check"; add: "flowAs" for the flow into the node, "outAs" for the flow it creates out of',
        '    it; split: "joinAs"; "refAs": the message, error, signal or escalation the element references) and use the',
        '    alias in later ops wherever an id goes ("after": "$check"); the result lists alias -> id.',
        '  - Sub-processes are drawn expanded by default (`--collapsed` / `set expanded=false` to collapse).',
        '  - Branches: the default flow (else the first outgoing flow) continues straight; the other branches alternate',
        '    below and above it in declaration order (`bpmn order` changes the order, `set <flowId> default=true` the continuation).',
        '  - One diagram root: the collaboration when pools exist, else the single process. Several root processes',
        '    need pools (participants). No Camunda 7 / 8 engine runs a complex gateway (its profile reports it).',
        '    Errors a file already has never block a write (W_PREEXISTING_ERROR).',
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
        '  4. bpmn validate <file>                   new errors block a write anyway; warnings are lint hints (with a',
        '                                            .bpmnlintrc also bpmnlint, whose errors fail validate: see BPMNLINT)',
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
        '                  A line that does not reach an end of its own (left at an old place by an older --no-layout',
        '                  write or another tool) is routed again and listed as rerouted.',
        '                  A batch places its new nodes like the same ops sent one by one (exception paths after the',
        '                  normal flow); a `connect` that would enter a merge backwards moves the merge after its sources.',
        '                  A new branch / boundary path whose rows below cross a line opens the row right under its anchor',
        '                  (the line moves down), or goes above it (a boundary event the CLI placed then on the top border;',
        '                  one drawn by hand keeps its border; the path of an event on the top border runs above its host);',
        '                  a crossing left is repaired once more (the flow routed again, the branch at its next row) when',
        '                  that lowers the score and crosses no two drawn lines: such a flow is listed as rerouted.',
        '  incremental     always keep the drawing (fails with E_LAYOUT_INCREMENTAL instead of redrawing).',
        '  full            always redraw (= --relayout; also `bpmn layout <file>`). Colours and DI ids survive, positions do not;',
        '                  a group box is drawn again around the elements it held (one around nothing keeps its box, or its',
        '                  size below the drawing when the redraw put shapes on it; a note says so).',
        '  design-iq stickies (bpmiq:sticky) move with the flow node nearest to them, never when no node moved.',
        '  The result says which mode ran and why, what was placed / moved / rerouted, and the layout quality before ->',
        '  after with the problems added and resolved (ids). A format command that changed the drawing (moved a shape,',
        '  rerouted a flow, moved a label) makes it hand-made, so later writes keep your formatting.',
      ].join('\n'),
    );
    out.push(heading('FORMATTING WITHOUT XML  (diagram only: the model does not change)'));
    out.push(
      [
        '  1. bpmn show <file> --layout       per pool / lane the rows of node ids (left to right) with their column',
        '                                     (c0..cN, " … " at a wide gap), wide empty gaps, colours, label sides,',
        '                                     and the layout problems with ids',
        '  2. place / align / space / route / label / color / order (lanes, pools) / tidy / compact: say where things',
        '     go by naming other elements; others give way, frames grow, flows are rerouted',
        '  3. bpmn metrics <file>             check that no overlaps / through / outsideLane / frameIntrusion were added',
        '  4. bpmn render <file> --problems -o <f.png>   look at it (read the PNG): the problems numbered, labels,',
        '                                     crossings, aesthetics the metrics miss (see LOOKING AT THE DRAWING)',
        '  Selectors (place, align, color, tidy): --path <fromId> <toId> [--via <flowId...>], --kind <kind>,',
        '  --branch <flowId> name many elements at once; elements are always named by id.',
        '  Recipes:',
        '    bpmn color f.bpmn Activity_A Flow_AToB Activity_B --color red       shapes and flows in red (default removes)',
        '    bpmn color f.bpmn --path Event_Start Event_Done --color green       the happy path (--via <flowId> picks a branch)',
        '    bpmn align f.bpmn --kind endEvent --axis column                     every end event in one column (the rightmost)',
        '    bpmn place f.bpmn Activity_Fix Event_Fixed --below Activity_Book    a branch one row below (rigid group)',
        '    bpmn place f.bpmn --branch Flow_OkToFix --below Activity_Book       the whole branch of Flow_OkToFix, up to the join',
        '    bpmn place f.bpmn Event_Done --row-of Activity_Check                same row, x unchanged',
      '    bpmn place f.bpmn Event_Overdue --side top                          a boundary event and its path on top',
        '    bpmn order f.bpmn Participant_Org Lane_Boss Lane_Clerk              lanes top to bottom',
        '    bpmn order f.bpmn Collaboration_Org Participant_Customer            pools top to bottom (the customer on top)',
        '    bpmn route f.bpmn Flow_Retry --exit bottom --entry bottom           a loop below',
        '    bpmn space f.bpmn --after Activity_Check                            room for one more column',
        '    bpmn space f.bpmn --after Activity_Check --by -column               close (up to) one column of empty space',
        '    bpmn compact f.bpmn                                                 close every empty row / column, shrink frames',
        '    bpmn label f.bpmn Gateway_Ok --side below',
        '    bpmn tidy f.bpmn                                                    remove overlaps (= layout --tidy)',
        '  In `apply` they are ops as well ({"op": "place", "ids": [...], "below": "..."}): they run after the semantic',
        '  ops and the layout, in batch order, all or nothing. A node cannot be placed out of its lane: `move --lane` first',
        '  (E_LEAVES_CONTAINER). No room next to the reference (E_NO_ROOM): run the `space` command of its hint (a dry',
        '  run checked it), then place again; in a batch, put the space op it names before the place op.',
      ].join('\n'),
    );
    out.push(heading('LOOKING AT THE DRAWING  (bpmn render; read the PNG it writes)'));
    out.push(LOOKING.join('\n'));
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
    out.push(heading('CAMUNDA 8  (Zeebe: the zeebe: namespace; `bpmn validate` runs the Camunda 8 profile)'));
    out.push(CAMUNDA8.join('\n'));
    out.push(heading('BPMNLINT  (the project\'s .bpmnlintrc in validate and every write)'));
    out.push(BPMNLINT.join('\n'));
    out.push(heading('CONVENTIONS  (the id conventions of the .bpmnlintrc: element-id-naming)'));
    out.push(CONVENTIONS.join('\n'));
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
    out.push('  validation: {errors, platform?, validators?: [{name, detail?, blocks?, errors, warnings, preexisting, resolved, counts,');
    out.push('  leftOut?: [{reason, count}]}]}, importWarnings, view?, conventions?: {ids, source}}. With --summary --json: {ok, file,');
    out.push('  written, unchanged, created: {<kind>: [ids]}, changed, removed, forced?, warnings: {added, resolvedCount, preexistingCount},');
    out.push('  leftOut?: [{validator, reason, count}], layout: {status, mode?, score?: {before?, after}, added?}, conventions?, notes? (only');
    out.push('  the note of flow ids BPMN_KEEP_FLOW_IDS kept, see OUTPUT)}.');
    out.push('  A validator\'s findings (the project\'s bpmnlint; a host\'s validators in library use) carry `validator` and');
    out.push('  `severity`; in text they read "[<name>] <code> <element>: <message>" ("[bpmnlint error] <rule> ..." for a bpmnlint');
    out.push('  error, "warning [bpmnlint error] <rule> ..." when a write added it: bpmnlint is advisory, `blocks: false`).');
    out.push('  Errors go to stderr as "error E_CODE: message" + "  hint: ..." (+ candidates; an E_VALIDATION refusal lists');
    out.push('  each error it would add on a line under the message); with --json as {ok: false, error: {code, message,');
    out.push('  element?, related?, candidates?, hint?, op?, command?, ops?, errors?}} (errors: those of an E_VALIDATION');
    out.push('  refusal, each with its code and hint; command, ops: the checked space run of an E_NO_ROOM).');
    out.push(this.kinds.placementSection());
    out.push(this.kinds.triggersSection());
    out.push(this.kinds.opsSection());
    out.push(this.kinds.exitCodesSection());
    out.push(heading('COMMON ERRORS'));
    for (const code of COMMON_ERRORS) {
      const e = ERROR_CATALOGUE.find((d) => d.code === code);
      if (e) out.push(`  ${e.code}: ${e.meaning}\n      fix: ${e.fix}`);
    }
    out.push('  The full catalogue: `bpmn kinds` (section ERRORS AND WARNINGS) or `bpmn kinds --json` -> errors.');
    return out.join('\n') + '\n';
  }

  /** `bpmn guide --short`: contract, reading, changing, ops keys, placement and the top errors in at most 5 KB. */
  short(): string {
    const out: string[] = [];
    out.push('bpmn — edit BPMN 2.0 models semantically (short guide; `bpmn guide <topic>` for one section, `bpmn guide` for all)');
    out.push(heading('CONTRACT'));
    out.push(
      [
        '  - You edit the model (kinds, names, flows, triggers, lanes, pools, properties, extensions), never the diagram: a',
        '    hand-made drawing is kept and changes are placed locally; a new file is drawn for you.',
        '  - Elements are addressed by id only (names may repeat). New ids speak in the file\'s id conventions (never a hash):',
        '    Activity_CheckInvoice, Gateway_AfterCheckInvoice, Flow_CheckInvoiceToBookInvoice; an explicit id (--id, "id")',
        '    always wins; every result names the ids it created. In apply, "as": "$name" names what an op creates and',
        '    later ops use "$name" as an id (the result lists alias -> id).',
        '  - Errors the file already had never block a write; a change that would add one is refused (E_VALIDATION). The',
        '    project\'s bpmnlint only reports what a change adds (`warning [bpmnlint error] ...`); validate fails on its errors.',
        '    Its element-id-naming sets the prefix and case of new ids: `bpmn show <file> --conventions` first.',
      ].join('\n'),
    );
    out.push(heading('READ'));
    out.push(
      [
        '  bpmn show <f> --around <id> [--depth 2]   neighbourhood: lanes, implementation, flows (cheap)',
        '  bpmn show <f> <id> --context             where it is, lane, before / after, what catches it, message flows',
        '  bpmn find <f> <text> [--kind <kind>]     ids by name or vendor value',
        '  bpmn show <f> [--scope <id>]             the whole model (or one process / pool / sub-process)',
        '  bpmn render <f> [--around <id>] --problems -o f.png   look at the drawing (read the PNG; guide render)',
      ].join('\n'),
    );
    out.push(heading('CHANGE'));
    out.push(
      [
        '  bpmn add <f> <kind[:trigger]> [name] [--after|--before|--flow|--in|--on <id>] [--id <id>] [key=value ...]',
        '  bpmn connect|set|remove|retype|move|order|ext ...     bpmn apply <f> ops.json   (one transaction, one layout)',
        '  Options: --summary (short result), --dry-run, -o <file|->, --json [--pretty]; `-` as <f> reads stdin.',
        '  Flow ids are API (generated code, tests)? --keep-flow-ids keeps them; W_FLOW_ID_STALE names a stale one.',
      ].join('\n'),
    );
    out.push(heading('OPS JSON  (bpmn apply; {"op": "<name>", ...}; * = required)'));
    out.push(this.opKeyLines().join('\n'));
    out.push(heading('PLACEMENT'));
    out.push(
      [
        '  --after X     append after a gateway / end of a path, else splice into X\'s single outgoing flow',
        '  --before Y    prepend before a join / start of a path, else splice into Y\'s single incoming flow',
        '  --flow F      splice into flow F (keeps name, condition; Flow_AToB is renamed)   --after X --before Y: into X -> Y',
        '  --in S        unconnected in process / sub-process / pool S       --on A: boundary event on activity A',
        '  --to T        also connect the new node to T',
      ].join('\n'),
    );
    out.push(heading('TOP ERRORS'));
    out.push(table(TOP_ERRORS.map(([code, fix]) => [code, fix])));
    out.push(`\nTopics (bpmn guide <topic>): ${Object.keys(GUIDE_TOPICS).join(', ')}. All codes: bpmn kinds --section errors.`);
    return out.join('\n') + '\n';
  }

  /** `bpmn guide <topic>`: the sections of the full guide a topic names; E_USAGE with the topics for an unknown one. */
  topic(topic: string): string {
    const key = topic.trim().toLowerCase().replace(/[\s_-]/g, '');
    const entry = Object.entries(GUIDE_TOPICS).find(([name]) => name === key);
    if (!entry) {
      const names = Object.keys(GUIDE_TOPICS);
      throw usageError(`Unknown guide topic "${topic}"`, { candidates: names, hint: 'Pass one of the listed topics, or `bpmn guide --short` for the core.' });
    }
    const sections = this.guideSections();
    const parts = entry[1].sections.map((title) => sections.find((s) => s.title.startsWith(title))?.text ?? '');
    return parts.filter(Boolean).join('\n\n') + '\n';
  }

  /** The guide's sections by heading (a heading is a line underlined with dashes). */
  private guideSections(): Array<{ title: string; text: string }> {
    const lines = this.text().split('\n');
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

  /** Every op with its keys (`*` = required; but FULL_GUIDE_ONLY_KEYS); add / retype fold their trigger keys into `<trigger keys>`. */
  private opKeyLines(): string[] {
    const triggerKeys = new Set([...TRIGGER_OPTIONS.flatMap((t) => t.keys), 'nonInterrupting']);
    return OP_NAMES.map((n) => {
      const fields = Object.entries(OP_FIELDS[n]).filter(([k]) => !FULL_GUIDE_ONLY_KEYS.has(k));
      // an op with the whole set of trigger options (add, retype) shows them as one item
      const folds = fields.filter(([k]) => triggerKeys.has(k)).length > 3;
      const keys = fields.filter(([k]) => !folds || !triggerKeys.has(k)).map(([k, spec]) => (spec.required ? `${k}*` : k));
      if (folds) keys.push('<trigger keys>');
      return `  ${n.padEnd(8)} ${keys.join(' ')}`;
    });
  }
}

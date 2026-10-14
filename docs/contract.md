# The contract and its limits

What the CLI guarantees, what a write does to the file, and where it stops. `bpmn guide contract`
prints the short form.

## The contract

1. **You edit the metamodel.** Every command names elements by id and changes the BPMN semantics.
   `bpmn show` prints the model in flow order without coordinates; that is all there is to read.
2. **The CLI keeps the picture.** Every mutating command ends with *validate -> layout -> atomic
   write* ([Layout modes](layout.md#layout-modes)); `--relayout` redraws on request, `--no-layout`
   skips the layout, `bpmn layout` redraws on its own. The picture is changed with the
   [format commands](layout.md#formatting-without-xml), which name elements, rows, columns and
   sides, never coordinates; `show --layout` and `metrics` read it back.
3. **Ids speak and follow the file.** A new id says what it names, in the id style the file uses
   ([reference.md](reference.md)): its prefixes (`Activity_`, `serviceTask_`, `Task_`, `SF_`), its
   case (`serviceTask_checkStock`, `Task_check_stock`) and its flow form (`flow_checkStockToShip`,
   `Flow_<from>_<to>`); a new file follows the bpmn-js conventions (`Activity_CheckInvoice`,
   `Event_OrderReceived`). Never a hash or a running number: a file of `Activity_0k3x9qa` or
   `Task_12` gets `Activity_CheckInvoice` or `Task_CheckInvoice`. Unnamed elements are named by
   kind and place (`Gateway_AfterCheckInvoice`), flows by their ends. Elements are addressed by id
   only (names may repeat); a taken id gets `_2`, `_3` (`W_ID_SUFFIXED`). Every result lists the
   ids it created; in an `apply` batch an alias (`"as": "$check"`) names what an op creates.
   Existing ids stay, with one exception: a flow whose id names its ends follows them, unless flow
   ids are kept with `--keep-flow-ids` ([Limitations](#limitations)). Where the project's
   `.bpmnlintrc` declares id conventions (`element-id-naming`), new ids follow them instead
   (`serviceTask_checkInvoice`; [bpmnlint](bpmnlint.md#id-conventions)); existing ids never change
   for them.
4. **Nothing is half done.** A command, or a whole `apply` batch, succeeds completely or leaves
   the file untouched. Structural validation errors the change would introduce block the write
   (`--force` overrides). Errors the file already had are reported as `W_PREEXISTING_ERROR` and do
   not block, so a file with an old problem stays editable. The same holds for the validators a
   library host passes ([Validators](validators.md)). The project's bpmnlint configuration
   ([bpmnlint.md](bpmnlint.md)) never blocks a write: the result lists the findings the change
   added, errors included, and `bpmn validate` fails on its errors.
5. **Conventions instead of coordinates.** Sub-processes are expanded by default; branches follow
   the rule under [The DI contract](#the-di-contract); exclusive gateways should be named as a
   question and their branches named; joins and parallel gateways stay unnamed. `bpmn validate`
   lints against these.

## The DI contract

- **Hand layouts are kept.** A semantic edit never throws away a drawing made in a modeler or
  changed with the format commands: existing shapes keep their bounds, existing connections their
  waypoints, and every other DI attribute (colours, foreign attributes, `isMarkerVisible`)
  survives. New elements are placed locally, removed ones pruned, affected connections rerouted.
- **The engine draws** a new file, a file without a diagram, a drawing it made itself and nobody
  changed (`auto`), and everything on request (`--relayout`, `--layout full`, `bpmn layout`). All
  shapes, edges, waypoints and labels then come from the model; colours are carried over by
  element id, manual positions are not.
- **DI ids stay.** A redraw changes coordinates, not ids: every `BPMNShape`, `BPMNEdge`, plane and
  diagram keeps its id (a plane named after the old root, `BPMNPlane_<processId>`, follows a new
  collaboration root, also when it was cut). New DI takes the file's style (`<id>_di`,
  `BPMNShape_<id>`, `Shape_<id>`): `BPMNShape_<id>` in a new drawing and in a full redraw of a file
  whose DI ids show no form, `<id>_di` in an incremental write there. It is cut at whole words like
  an element id so that every DI id bpmn-cli writes has at most 64 characters. A DI id derived
  from an element's id (also with a `_2`) follows `set <id> id=` and a flow renamed after its ends
  (`_2` when the new one is taken); any other DI id stays.
- **design-iq stickies follow their node.** A `bpmiq:sticky` extension element of a process
  (absolute `x` / `y`, no DI) belongs to the flow node nearest to it. When a write moves that node
  the sticky moves by the same shift; a write that moves no node never touches it. The result
  lists them (`stickies moved: Sticky_1 (with Activity_Check)`, JSON `layout.stickies`).
- **Expanded / collapsed** is kept from the existing DI. A sub-process is collapsed only when the
  DI says so or you ask (`add ... --collapsed`, `set <id> expanded=false`, `layout --collapse
  <id>`); `layout --expand <id>` expands it again. In a kept drawing collapsing moves the content
  to its own diagram and closes the gap, expanding makes room.
- **`--no-layout`** writes the model with the old DI left in place (DI of removed elements is
  pruned): new elements have no shape until the next write or `bpmn layout`.
- **Branches.** At a split the layouter draws one outgoing flow straight (the "spine"): the
  default flow, or without one the first declared flow that leads to an end event (else the
  first). The other branches are placed alternately below and above the spine in declaration
  order; with a default flow they all go below it. The CLI declares a new node right after its
  anchor and a flow right after its source; `bpmn order` reorders the flows, `set <flowId>
  default=true` picks the spine. In a kept drawing a new branch goes one row below the existing
  branches of its split.
- **Lanes** are only drawn inside a pool (`W_LANES_WITHOUT_POOL`): add a participant, it wraps
  the existing process.

## What a write changes

A write rewrites only the elements the change touched, in the file's own style, so git or a host
that syncs one text region per save (design-iq) sees only the change.

- **Everything else keeps its text**, byte for byte: the XML declaration and the comments before
  the root, the root start tag with its namespace declarations in their order, vendor attributes
  before or between the typed ones, quoting, entities (`&amp;` stays `&amp;`), CDATA sections,
  comments, blank lines, indentation, a missing final line break. A rename changes one line (for a
  labelled event or gateway the layout also fits the label's bounds).
- **A changed element keeps its style**: its start tag as written when only its children changed,
  else its attributes in their order with the new values (a new attribute goes after the one
  bpmn-moddle writes before it). A script or condition in CDATA stays CDATA, a label on one line
  stays on one line, a retype keeps the attributes and renames both tags.
- **A new element follows the file**: its indentation unit (two or four spaces, tabs), its line
  breaks, `/>` with or without a space. It goes after the sibling bpmn-moddle writes before it. A
  namespace the change needs is added to the root tag, which otherwise stays as written.
- **No-op**: when the result equals the file (a rename to the current name, `set` to the current
  value, `tidy` on a tidy drawing) nothing is written and the modification time stays:
  `unchanged: <file>` (JSON `"written": false, "unchanged": true`). `--out <other>` still writes
  the copy; `--dry-run` says `(unchanged)`.
- **`incoming` / `outgoing` lists** are written the way the file keeps them. A file that never
  lists them never gets them; a file that lists them (Camunda Modeler, bpmn-js) gets the entries
  of new and changed flows; a missing entry of an unchanged flow is not added. A new file, and one
  without any sequence flow yet, gets them the way the Modeler writes them.
- **Comments** inside an element the change removes or rewrites, on the lines right before it or
  after it on its last line, go with it; the result says so (`note: 1 XML comment(s) dropped:
  ...`). All other comments stay where they are.
- **Encoding**: a file is read in the encoding its XML declaration names (UTF-8 without one,
  UTF-16 by its byte order mark, ISO-8859-1 / Windows-1252 and the other encodings a browser
  knows; one that cannot be decoded is `E_IO` unless the file is plain ASCII). Every write is
  UTF-8, and a written file whose declaration named another encoding then declares UTF-8, with a
  note. A no-op keeps the file's bytes. The in-memory API does the same on strings: store a
  changed result as UTF-8.
- **Safety**: the result must read back with bpmn-moddle as exactly the changed model. If it does
  not, or the file has something the text reader does not support (a DOCTYPE), the whole file is
  written the way bpmn-moddle serialises it, with the note `the file's formatting was not kept
  (<reason>) ...` and the number of comments dropped. A forced write of a lossy import (`--force`
  on `E_IMPORT_LOSSY`) is always written that way and drops what bpmn-moddle could not read.
- **The layout still changes the drawing** where it acts: in `auto` mode a file without a diagram
  is drawn on its first write, missing DI (an edge without a `BPMNEdge`, a plane without
  `bpmnElement`) is completed, and a task grows when its name no longer fits. `--no-layout` only
  removes the DI of removed elements. A full redraw rewrites the geometry of the DI section.

`npm run roundtrip` measures this on a corpus of no-ops, renames and inserts
([testing.md](testing.md#roundtrip-fidelity)).

## Limitations

- **One root** is laid out: the collaboration when pools exist, otherwise the single process.
  Several root processes without pools are a validation error (`E_MULTIPLE_ROOTS`), and so is a
  process that no pool references while a collaboration exists (`E_ORPHAN_PROCESS`).
- **Not supported**: `complexGateway`, choreographies, implicit throw events and groups. A file
  that already has one can still be edited (`W_PREEXISTING_ERROR`), and `retype` turns a complex
  gateway into a supported one.
- **The built-in engine** draws conventional, readable diagrams: expect long edges in models with
  many re-joins, and dotted association lines that cross a sequence flow where no free route
  exists. `--engine auto` uses `bpmn-auto-layout@2.0.0-alpha.2` (pinned) as a fallback.
- **Frames shrink only strip by strip.** The format commands grow frames when they need room;
  `compact` and `space --by -<amount>` close only rows and columns that are empty across the whole
  pool or lane band, so a spread-out drawing shrinks less than a full redraw (`bpmn layout`) would.
- **Groups** (`bpmn:Group` boxes) are not frames: shapes may be placed into or out of a group's
  box, and a node placed next to an element inside a group goes into that group, which grows. A
  full redraw (`bpmn layout`, `--relayout`, an engine-owned drawing in `auto` mode, `--engine auto`)
  draws a group again around the elements its box held (a shape whose centre lay inside; a pool,
  lane, expanded sub-process or group inside whole), 20 px around them (40 above for its name), the
  padding at most half-way to a neighbour that is no member. A group around nothing keeps its box,
  or its size below the drawing when the redraw put shapes on it, and the layout block has a note.
  A second redraw of the result changes nothing. The built-in engine keeps the parts of a group
  that no flow connects together; members of one connected flow stay where the flow puts them, so
  a box around members the redraw spread out also takes in what lies between them, and its border
  can cut a shape that lies partly between them (a wide annotation). Two groups that overlap
  without one inside the other are not kept apart: one box can take in the other. An association
  between a text annotation and a group is not drawn by a full redraw (`W_LAYOUT_DI_NOT_CREATED`).
  The layout metrics never count a group as overlapping its members.
- **Vertical pools and lanes** (`isHorizontal="false"`) are not supported by the incremental
  layout and the format commands. An edit that would place, move or route anything on such a
  diagram is redrawn in full in `auto` mode (`W_LAYOUT_INCREMENTAL_FAILED`) and refused with
  `--layout incremental` (`E_LAYOUT_INCREMENTAL`); renames and property changes keep the drawing.
- **A second `BPMNDiagram`** of a process or collaboration that another diagram already shows is
  a read-only view for the incremental layout: DI of removed elements is pruned, nothing else.
- **Lossy imports**: a file with content bpmn-moddle cannot represent (unknown elements,
  unresolved references, duplicate ids, an element the schema allows once appearing twice, such as
  two `loopCharacteristics` on one task) is refused with `E_IMPORT_LOSSY`; `show` and `validate`
  print the findings as `import:` lines. `--force` writes anyway, drops that content (of a
  duplicate element the last one stays) and uses bpmn-moddle's formatting. The library refuses
  such a file the same way (`Doc.fromXml` + `mutateDoc` without `force: true`).
- **Element order is not repaired.** A write keeps the order of the file's elements, so an
  element in a place the BPMN XSD does not allow stays there, also after `bpmn layout`. The
  engines refuse such a file before and after the edit.
- **Merges can produce duplicate ids.** New ids come from names and places, so two branches of a
  file (git, two agents) that each add an element of the same name, or an unnamed element next to
  anchors of the same name, get the same id. The next read refuses the merged file
  (`E_IMPORT_LOSSY`): rename one of them while resolving the merge.
- **A flow id that names its ends is renamed** when an edit changes its ends (a splice, a bridge,
  `move`, `set <flow> source=` / `target=`), so the id keeps naming what it connects. This is the
  one exception to "existing ids never change". Where flow ids are API (generated code, process
  tests), `--keep-flow-ids` on any mutating command or `apply` keeps them. `BPMN_KEEP_FLOW_IDS=1`
  makes that the default of a shell or an agent session; the flag wins over the variable, and
  `--no-keep-flow-ids` renames again. The change then names each flow whose id no longer names
  its ends (`W_FLOW_ID_STALE`, with the `bpmn set <file> <flowId> id=<newId>` that renames it
  deliberately, together with the code). A flow the same change created still follows its ends.
  Where the variable kept the ids and that changed the result (a `W_FLOW_ID_STALE`, or a move
  that put the node's old out-flow back), the result says so
  (`note: flow ids kept: BPMN_KEEP_FLOW_IDS=1 (...)`), and an `E_NOT_FOUND` of an `apply` batch
  says it in its hint. Library: `keepFlowIds: true`, or `Doc.followFlowEnds = false`.
- **The Camunda 8 profile checks FEEL syntax, not meaning.** An unknown variable or function, a
  type error, or a FEEL value Camunda 8 parses only when the process runs is found by the engine
  only; where Camunda's grammar was not probed the check accepts. An event-based gateway in a
  file that leaves out the `<bpmn:outgoing>` lists is refused by Camunda 8 (the profile reports
  it), and a write keeps the file's way of listing them. `zeebe:publishMessage` (accepted by
  Camunda 8.9, not run) is known to the profile only, not to the Zeebe descriptor.
- **Hand-edited files with broken links** are not repaired: `bpmn validate` reports them
  (`E_DANGLING_REF`, `E_FLOW_LINKS`).

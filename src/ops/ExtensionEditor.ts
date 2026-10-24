/**
 * `ext`: vendor extension elements inside <bpmn:extensionElements>.
 *
 * Vendor content stays generic in the model (camunda-bpmn-moddle is never
 * registered, see src/platform/VendorDescriptor.ts); this module knows just enough
 * of its structure to never write a file the engines reject or ignore.
 *
 * CONTRACT
 *  - add: op.type is `prefix:localName` or a path of such steps
 *    (`camunda:connector/camunda:inputParameter`, see "selectors"). The
 *    namespace comes from a snippet-local xmlns, the file's xmlns declarations
 *    or KNOWN_NAMESPACES (else E_UNKNOWN_NAMESPACE); when the file already
 *    binds that namespace URI to another prefix, the file's prefix is used
 *    (never a second prefix for one URI). A bpmn: element is refused at the
 *    top level of extensionElements (E_INVALID_VALUE) and accepted nested in a
 *    vendor element (timeout task listener -> bpmn:timerEventDefinition,
 *    camunda:potentialStarter -> bpmn:resourceAssignmentExpression).
 *    op.xml: a raw snippet; each root element is inserted. With op.type as
 *    well, every root must be of that type (E_INVALID_VALUE otherwise).
 *  - structure rules applied on insert (ops/ExtensionStructure.ts):
 *    - child types go into their container, created when missing:
 *      camunda:inputParameter / camunda:outputParameter -> camunda:inputOutput,
 *      camunda:formField -> camunda:formData, camunda:property ->
 *      camunda:properties, camunda:connectorId -> camunda:connector,
 *      zeebe:input / zeebe:output -> zeebe:ioMapping, zeebe:header ->
 *      zeebe:taskHeaders, zeebe:property -> zeebe:properties, ...
 *      (camunda containers come from the descriptor: a type that may only be
 *      nested and has exactly one container type, which may sit in
 *      extensionElements). Inside a path the same rule applies one level down
 *      (camunda:connector/camunda:inputParameter -> the connector's inputOutput).
 *    - keyed items (KEYS): an item with the same type and key (name / id /
 *      target / key) is replaced in place and reported; what the old item
 *      held and the new one does not (attributes, value, children) is
 *      W_PROPERTY_DROPPED, its hint the --xml that keeps it (not with
 *      --replace, which asks for the whole item).
 *    - single-instance types (singleTop, SINGLE_CHILD): a second one is
 *      merged into the existing one (attributes, body, children with the same
 *      rules); a conflicting attribute or body, or a file that already holds
 *      several of them, fails with E_DUPLICATE_EXTENSION (hint --replace).
 *    - op.replace: elements of the same type (and key) at the insertion level
 *      are removed first, the new one is appended (whole-container replace).
 *    - a camunda type that may only be nested and has no unique container
 *      (camunda:value, camunda:validation, camunda:script, ...) or a
 *      camunda:field on an element that does not read fields is added as
 *      given with W_MISPLACED_EXTENSION and a path hint.
 *    - bpmn:definitions (and DI elements) cannot hold extensionElements
 *      (BPMN 2.0 XSD; the engines reject it): E_WRONG_KIND.
 *  - remove: by index (top level; op.type may carry it as in the CLI: `2`,
 *    `loop.2`, `definition[1].0`) or by selector. One step without predicate
 *    removes every element of that type at the top level (or, when there is
 *    none, inside its container: `camunda:inputParameter` removes the input
 *    parameters); `type[attr=value]` / `type[n]` pick one item; a path
 *    selects inside containers. A container left empty (camunda:inputOutput
 *    without parameters, ...) is removed too, an empty extensionElements as
 *    well. Nothing matching: E_NO_EXTENSION listing what is there.
 *  - ExtensionLister: [{index, type, attrs, body?, children?: [...]}] for
 *    `ext list` and for `show <id>`.
 *  - nested elements: a `definition.` / `loop.` / `condition.` prefix (or
 *    op.slot); one of several event definitions: `definition[<n>].` /
 *    `definition[<trigger>].` (E_AMBIGUOUS_NESTED without it, see set.ts).
 *
 * Selectors: ops/SelectorParser.ts.
 *
 * The --xml snippet: ops/ExtSnippetReader.ts.
 */
import type { Doc } from '../model/Doc.js';
import { usageError } from '../shared/utils/errors.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { idOf } from './utils/elements.js';
import { ExtensionInserter } from './ExtensionInserter.js';
import { ExtensionRemover } from './ExtensionRemover.js';
import { NESTED_HOSTS } from './NestedHosts.js';
import { ZeebeSubscription } from './ZeebeSubscription.js';
import type { ExtOp } from './types.js';

export class ExtensionEditor {
  constructor(private readonly doc: Doc) {}

  /** Runs an `ext` operation (add / remove). */
  apply(op: ExtOp): ChangeSet {
    const doc = this.doc;
    let owner = doc.require(op.id);
    if (op.action !== 'add' && op.action !== 'remove') throw usageError(`Unknown ext action "${String(op.action)}"; use add or remove`, { element: op.id });
    const notes: string[] = [];
    // Camunda 8 reads a correlation key on the message, not on the event that waits for it
    const subscription = new ZeebeSubscription(doc);
    const message = subscription.messageFor(owner, op);
    if (message) {
      notes.push(subscription.note(owner, message, `${subscription.addedTypeText(op)}`));
      const split = op.type ? NESTED_HOSTS.splitSlot(op.type) : undefined;
      const { slot: _slot, ...rest } = op;
      op = { ...rest, id: idOf(message), ...(split ? { type: split.rest } : {}) };
      owner = message;
    }
    const { host, op: inner } = NESTED_HOSTS.resolve(doc, owner, NESTED_HOSTS.normalizeIndex(op), notes);
    const cs = inner.action === 'add' ? new ExtensionInserter(doc).add(host, inner) : new ExtensionRemover(doc).remove(host, inner);
    for (const n of notes) cs.note(n);
    return cs;
  }
}

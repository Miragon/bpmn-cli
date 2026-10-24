export { idOf, descriptorOf, isEl } from './utils/elements.js';
export { definitionsOf, nestedEntries, NESTED_SLOTS, parseSlotRef, resolveNested, SLOT_TEXT, slotsOf, type NestedSlot } from './utils/nested-slots.js';
import { ChangeSet } from '../model/ChangeSet.js';
export const changeOf = ChangeSet.entryOf;

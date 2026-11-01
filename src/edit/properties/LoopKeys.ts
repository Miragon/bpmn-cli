import { type BpmnElement, type ChangeSet, ElementText, ElementWalk, Kinds } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class LoopKeys {
  constructor(private readonly edit: EditSession) {}

  private expression(body: string, parent: BpmnElement, language?: string): BpmnElement {
    const expr = this.edit.document.tree.build('bpmn:FormalExpression', { body, ...(language ? { language } : {}) });
    expr.parent = parent;
    return expr;
  }

  write(el: BpmnElement, key: string, value: string, changes: ChangeSet): void {
    const current = el.get<BpmnElement | undefined>('loopCharacteristics');
    const isMulti = !!current?.is('bpmn:MultiInstanceLoopCharacteristics');
    if (key === 'completion' && el.is('bpmn:AdHocSubProcess') && !isMulti) {
      el.set('completionCondition', value ? this.expression(value, el) : undefined);
      return;
    }
    if (key === 'loop') {
      const mode = (value || 'none').trim().toLowerCase();
      if (mode === 'none') {
        el.set('loopCharacteristics', undefined);
        if (current) {
          this.dropLoop(el, current, mode, changes);
        }
      } else if (mode === 'standard') {
        if (!current?.is('bpmn:StandardLoopCharacteristics')) {
          const loop = this.edit.document.tree.build('bpmn:StandardLoopCharacteristics');
          loop.parent = el;
          el.set('loopCharacteristics', loop);
          if (current) {
            this.dropLoop(el, current, mode, changes);
          }
        }
      } else if (mode === 'parallel' || mode === 'sequential') {
        const multi = isMulti ? current! : this.createMultiInstance(el);
        multi.set('isSequential', mode === 'sequential');
        if (current && !isMulti) {
          this.dropLoop(el, current, mode, changes);
        }
      } else {
        throw PropertyCoercer.invalid(el, key, `"${value}" is not one of none|standard|parallel|sequential`);
      }
      return;
    }
    const prop = key === 'cardinality' ? 'loopCardinality' : 'completionCondition';
    if (!value) {
      if (isMulti) {
        current!.set(prop, undefined);
      }
      return;
    }
    if (current && !isMulti) {
      throw PropertyCoercer.invalid(el, key, `${key} needs a multi-instance loop, but ${el.id} has a standard loop`, 'Set loop=parallel or loop=sequential first.');
    }
    let multi = current;
    if (!multi) {
      multi = this.createMultiInstance(el);
      changes.note(`${el.id}: created a parallel multi-instance loop for ${key}`);
    }
    multi.set(prop, this.expression(value, multi));
  }

  private createMultiInstance(el: BpmnElement): BpmnElement {
    const multi = this.edit.document.tree.build('bpmn:MultiInstanceLoopCharacteristics');
    multi.parent = el;
    el.set('loopCharacteristics', multi);
    return multi;
  }

  private dropLoop(el: BpmnElement, old: BpmnElement, mode: string, changes: ChangeSet): void {
    for (const element of new ElementWalk(old).depthFirst({ bpmnOnly: true })) {
      const id = element.get<string | undefined>('id');
      if (id) {
        this.edit.document.ids.registry.release(id);
      }
    }
    const lost = ElementText.vendorContent(old);
    if (!lost.length) {
      return;
    }
    const oldId = old.get<string | undefined>('id');
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${lost.join(', ')} of the ${Kinds.typeLabel(old)}${oldId ? ` ${oldId}` : ''} of ${el.id} ${lost.length > 1 ? 'were' : 'was'} dropped: loop=${mode} ${mode === 'none' ? 'removes the loop' : 'replaces it'}`,
      element: el.id,
      hint: 'Vendor attributes and extension elements belong to the old loop characteristics; set what the new loop still needs with `bpmn set <file> <id> loop.<prefix>:<attr>=<value>`.',
    });
  }
}

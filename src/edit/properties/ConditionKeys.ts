import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet } from '../../model/index.js';
import { SequenceFlows } from '../flows/SequenceFlows.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class ConditionKeys {
  constructor(private readonly edit: EditSession) {}

  write(flow: BpmnElement, keys: Map<string, string>, changes: ChangeSet): void {
    const existing = flow.get<BpmnElement | undefined>('conditionExpression');
    const resourceKey = new PropertyCoercer(this.edit).resourceKeyOf(existing);
    if (!keys.has('condition')) {
      ConditionKeys.writeLanguage(flow, existing, resourceKey, keys, changes);
      return;
    }
    const condition = keys.get('condition') ?? '';
    if (!condition) {
      this.removeCondition(flow, keys, changes);
      return;
    }
    this.edit.document.flowRules.assertCondition(condition);
    const oldLanguage = existing?.get<string | undefined>('language');
    const dropped: string[] = [];
    const language = ConditionKeys.keptLanguage(keys, condition, oldLanguage, resourceKey, dropped);
    if (!existing || !existing.is('bpmn:FormalExpression')) {
      new SequenceFlows(this.edit).setCondition(flow, condition, language);
    } else {
      ConditionKeys.rewriteExpression(flow, existing, condition, language, resourceKey, dropped);
    }
    if (dropped.length) {
      ConditionKeys.warnDropped(flow, condition, oldLanguage, resourceKey, dropped, changes);
    }
    changes.change(ChangeEntries.of(flow, `condition=${condition}${language ? ` (${language})` : ''}`));
  }

  private static writeLanguage(flow: BpmnElement, existing: BpmnElement | undefined, resourceKey: string | undefined, keys: Map<string, string>, changes: ChangeSet): void {
    const language = keys.get('language') || undefined;
    if (!existing || (!existing.get<string | undefined>('body') && !resourceKey)) {
      if (language) {
        throw BpmnError.model('E_NO_CONDITION', `${flow.id} has no condition to set a language on`, { element: flow.id, hint: 'Set condition=<expression> (or condition.camunda:resource=<uri>) too.' });
      }
      return;
    }
    existing.set('language', language);
    changes.change(ChangeEntries.of(flow, language ? `language=${language}` : 'language removed'));
  }

  private removeCondition(flow: BpmnElement, keys: Map<string, string>, changes: ChangeSet): void {
    if (keys.get('language')) {
      throw BpmnError.model('E_NO_CONDITION', `${flow.id} has no condition to set a language on`, { element: flow.id, hint: 'Set condition=<expression> too.' });
    }
    new SequenceFlows(this.edit).setCondition(flow, undefined);
    changes.change(ChangeEntries.of(flow, 'condition removed'));
  }

  private static keptLanguage(keys: Map<string, string>, condition: string, oldLanguage: string | undefined, resourceKey: string | undefined, dropped: string[]): string | undefined {
    if (keys.has('language')) {
      return keys.get('language') || undefined;
    }
    if (oldLanguage && (resourceKey || (PropertyCoercer.isExpression(condition) && oldLanguage.toLowerCase() !== 'juel'))) {
      dropped.push(`language ${oldLanguage}`);
      return undefined;
    }
    return oldLanguage;
  }

  private static rewriteExpression(flow: BpmnElement, existing: BpmnElement, condition: string, language: string | undefined, resourceKey: string | undefined, dropped: string[]): void {
    if (resourceKey) {
      dropped.unshift(`${resourceKey} ${String(existing.attrs[resourceKey])}`);
      delete existing.attrs[resourceKey];
    }
    existing.set('body', condition);
    existing.set('language', language);
    const source = flow.get<BpmnElement | undefined>('sourceRef');
    if (source?.get<BpmnElement | undefined>('default') === flow) {
      source.set('default', undefined);
    }
  }

  private static warnDropped(flow: BpmnElement, condition: string, oldLanguage: string | undefined, resourceKey: string | undefined, dropped: string[], changes: ChangeSet): void {
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `${dropped.join(' and ')} of the condition of ${flow.id} ${dropped.length > 1 ? 'were' : 'was'} dropped: ${resourceKey ? 'the inline condition replaces the script resource' : `"${condition}" is an expression, not a ${oldLanguage} script`}`,
      element: flow.id,
      hint: resourceKey
        ? 'To keep a script resource set condition.camunda:resource=<uri> (and language=<lang>) instead of condition=; to run the inline body as a script add language=<lang>.'
        : `Pass language=${oldLanguage} together with condition= to keep the script language.`,
    });
  }
}

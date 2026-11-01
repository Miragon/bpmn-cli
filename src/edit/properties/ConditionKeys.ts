import { type BpmnElement, BpmnError, ChangeEntries, type ChangeSet } from '../../model/index.js';
import { SequenceFlows } from '../flows/SequenceFlows.js';
import type { EditSession } from '../session/EditSession.js';
import { PropertyCoercer } from './PropertyCoercer.js';

export class ConditionKeys {
  constructor(private readonly edit: EditSession) {}

  private static isJuel(body: string): boolean {
    return /^\s*[$#]\{[\s\S]*\}\s*$/.test(body);
  }

  write(flow: BpmnElement, keys: Map<string, string>, changes: ChangeSet): void {
    const existing = flow.get<BpmnElement | undefined>('conditionExpression');
    const oldBody = existing?.get<string | undefined>('body');
    const oldLanguage = existing?.get<string | undefined>('language');
    const resourceKey = new PropertyCoercer(this.edit).resourceKeyOf(existing);
    const hasCondition = !!existing && (!!oldBody || !!resourceKey);
    if (!keys.has('condition')) {
      const language = keys.get('language') || undefined;
      if (!hasCondition) {
        if (language) {
          throw BpmnError.model('E_NO_CONDITION', `${flow.id} has no condition to set a language on`, { element: flow.id, hint: 'Set condition=<expression> (or condition.camunda:resource=<uri>) too.' });
        }
        return;
      }
      existing!.set('language', language);
      changes.change(ChangeEntries.of(flow, language ? `language=${language}` : 'language removed'));
      return;
    }
    const condition = keys.get('condition') ?? '';
    if (!condition) {
      if (keys.get('language')) {
        throw BpmnError.model('E_NO_CONDITION', `${flow.id} has no condition to set a language on`, { element: flow.id, hint: 'Set condition=<expression> too.' });
      }
      new SequenceFlows(this.edit).setCondition(flow, undefined);
      changes.change(ChangeEntries.of(flow, 'condition removed'));
      return;
    }
    this.edit.document.flowRules.assertCondition(condition);
    const dropped: string[] = [];
    let language: string | undefined;
    if (keys.has('language')) {
      language = keys.get('language') || undefined;
    } else if (oldLanguage && resourceKey) {
      dropped.push(`language ${oldLanguage}`);
    } else if (oldLanguage && ConditionKeys.isJuel(condition) && oldLanguage.toLowerCase() !== 'juel') {
      dropped.push(`language ${oldLanguage}`);
    } else {
      language = oldLanguage;
    }
    if (!existing || !existing.is('bpmn:FormalExpression')) {
      new SequenceFlows(this.edit).setCondition(flow, condition, language);
    } else {
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
    if (dropped.length) {
      changes.warn({
        code: 'W_PROPERTY_DROPPED',
        message: `${dropped.join(' and ')} of the condition of ${flow.id} ${dropped.length > 1 ? 'were' : 'was'} dropped: ${resourceKey ? 'the inline condition replaces the script resource' : `"${condition}" is an expression, not a ${oldLanguage} script`}`,
        element: flow.id,
        hint: resourceKey
          ? 'To keep a script resource set condition.camunda:resource=<uri> (and language=<lang>) instead of condition=; to run the inline body as a script add language=<lang>.'
          : `Pass language=${oldLanguage} together with condition= to keep the script language.`,
      });
    }
    changes.change(ChangeEntries.of(flow, `condition=${condition}${language ? ` (${language})` : ''}`));
  }
}

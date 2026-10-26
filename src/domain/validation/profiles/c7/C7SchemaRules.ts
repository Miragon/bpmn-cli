import type { El } from '../../../document/utils/moddle.js';
import { idOf, list, peek, TIMER_ELEMENTS, triggerName } from '../../utils/element.js';
import { sh } from '../../utils/hint.js';
import { C7Rules } from './C7Rules.js';

/**
 * What the BPMN schema refuses anywhere in the file: the engines validate the whole file against
 * it, non-executable processes, ignored event definitions and the diagram included.
 */
export class C7SchemaRules extends C7Rules {
  /**
   * Attributes without a namespace prefix that BPMN does not define (cvc-complex-type.3.2.2);
   * vendor attributes need their prefix.
   */
  checkSchemaAttributes(): void {
    for (const { el, owner, id, di, addr, keys } of this.unprefixedAttributes()) {
      for (const key of keys) {
        const vendor = this.kit.camunda.attr(key);
        const fits = !!vendor && vendor.owners.some((ownerType) => this.kit.is(el, ownerType)) && !!id && el === owner;
        const where = el === owner ? this.describe(el, undefined) : `${el.$type}${id ? ` in ${id}` : ''}`;
        const remove = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : undefined;
        /**
         * an unprefixed decision link (bpmn-cli's calledDecision, or calledElement read as one):
         * `set calledDecision=` writes the engines' spelling, unless another implementation stays
         */
        const implemented = Object.keys(el.$attrs ?? {}).some((attributeName) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(attributeName) && this.kit.camunda.reads(this.ns.uriOfName(attributeName)));
        const link = el === owner && !!id && !implemented && this.kit.is(el, 'bpmn:BusinessRuleTask') && (key === 'calledDecision' || key === 'calledElement') ? new this.kit.DecisionLinkReader(this.doc).linkOf(el) : undefined;
        const hint = link
          ? `Write the decision link in the engines' spelling: \`bpmn set <file> ${id} ${sh(`calledDecision=${link.value}`)}\` (${this.prefix}:decisionRef; the unprefixed ${key} is removed).`
          : fits
          ? `Use the vendor attribute instead: \`bpmn set <file> ${id} ${sh(`${key}=`)} ${sh(`${this.prefix}:${key}=${String(el.$attrs[key] ?? '')}`)}\`.`
          : remove
            ? `Remove it: ${remove} (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`
            : di
              ? `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram, which writes new diagram elements: \`bpmn layout <file>\` (the hand-made layout is lost).`
              : `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''} (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`;
        this.push('deploy', 'W_C7_DEPLOY_SCHEMA', el, owner, `schema:${key}`, `${where} has the attribute ${key}, which the BPMN schema does not define${fits ? ` (did you mean ${this.prefix}:${key}?)` : ''}; the engines validate the file against the schema and refuse it`, hint);
      }
    }
  }

  /**
   * What the schema requires of every event definition, also one the engines would ignore: a
   * conditional definition has a condition, a link definition a name, a timer at most one of
   * timeDate, timeCycle and timeDuration.
   */
  checkSchemaEventDefinitions(): void {
    for (const def of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      if (!this.kit.is(def, 'bpmn:EventDefinition')) continue;
      const parent = def.$parent as El | undefined;
      const event = parent && this.kit.is(parent, 'bpmn:Event') && idOf(parent) ? parent : undefined;
      const id = idOf(event);
      const defs = list(event, 'eventDefinitions');
      const subject = defs.length > 1 ? `#${defs.indexOf(def)}` : '';
      /** the fix, or how to drop this definition when the engines act on another one */
      const fix = (cmd: string, keeps: string): string => {
        if (!id) return 'Fix it in the XML.';
        if (defs.length < 2) return `\`bpmn set <file> ${id} ${cmd}\`${keeps ? ` (${keeps})` : ''}.`;
        const acting = this.actingDefinition(event!);
        const only = `\`bpmn set <file> ${id} ${cmd}\` (keeps only the ${triggerName(def)} definition)`;
        if (!acting || acting === def) return `${only}.`;
        return `The engines act on the ${triggerName(acting)} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${id} trigger=${triggerName(acting)}\` (keeps only the ${triggerName(acting)}), or ${only}.`;
      };
      const label = id ? this.describe(event!, undefined) : `${def.$type}${idOf(def) ? ` ${idOf(def)}` : ''}`;
      // `Conditional event X`, or among several `The conditional definition of <event>`
      const what = (single: string): string => (defs.length > 1 ? `The ${triggerName(def)} definition of ${label}` : id ? `${single} ${id}` : label);
      if (this.kit.is(def, 'bpmn:ConditionalEventDefinition') && !peek<El>(def, 'condition')) {
        this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, `condition${subject}`, `${what('Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, fix(sh('when=${expression}'), ''));
      } else if (this.kit.is(def, 'bpmn:LinkEventDefinition') && (peek<string>(def, 'name') === undefined || peek<string>(def, 'name') === null)) {
        this.push('deploy', 'W_C7_DEPLOY_LINK', event ?? def, undefined, `link:name${subject}`, `${what('Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, fix('link=<Name>', 'the throw and the catch event of a pair share the name'));
      } else if (this.kit.is(def, 'bpmn:TimerEventDefinition')) {
        const set = TIMER_ELEMENTS.filter((timerKind) => peek<El>(def, timerKind));
        if (set.length < 2) continue;
        this.push('deploy', 'W_C7_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, `timer:elements${subject}`, `${what('Timer event')} has ${set.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, fix('timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go'));
      }
    }
  }
}

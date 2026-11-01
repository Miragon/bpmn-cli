import { type BpmnElement, CAMUNDA, DecisionLinkReader } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C7SchemaRules extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Definitions')) {
      this.checkSchemaEventDefinitions(reporter);
      this.checkSchemaAttributes(reporter);
    }
  }

  checkSchemaAttributes(reporter: RuleReporter): void {
    for (const { el, owner, id, di, addr, keys } of this.unprefixedAttributes()) {
      for (const key of keys) {
        const vendor = CAMUNDA.attr(key);
        const fits = !!vendor && vendor.owners.some((ownerType) => el.is(ownerType)) && !!id && el === owner;
        const where = el === owner ? this.describe(el, undefined) : `${el.type}${id ? ` in ${id}` : ''}`;
        const remove = addr ? `\`bpmn set <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${key}=`)}\`` : undefined;
        const implemented = Object.keys(el.attrs ?? {}).some((attributeName) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(attributeName) && CAMUNDA.reads(this.ns.uriOfName(attributeName)));
        const link = el === owner && !!id && !implemented && el.is('bpmn:BusinessRuleTask') && (key === 'calledDecision' || key === 'calledElement') ? new DecisionLinkReader(this.document.namespaces).linkOf(el) : undefined;
        const hint = link
          ? `Write the decision link in the engines' spelling: \`bpmn set <file> ${id} ${ShellWords.quote(`calledDecision=${link.value}`)}\` (${this.prefix}:decisionRef; the unprefixed ${key} is removed).`
          : fits
          ? `Use the vendor attribute instead: \`bpmn set <file> ${id} ${ShellWords.quote(`${key}=`)} ${ShellWords.quote(`${this.prefix}:${key}=${String(el.attrs[key] ?? '')}`)}\`.`
          : remove
            ? `Remove it: ${remove} (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`
            : di
              ? `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram, which writes new diagram elements: \`bpmn layout <file>\` (the hand-made layout is lost).`
              : `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''} (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`;
        reporter.deploy({ code: 'W_C7_DEPLOY_SCHEMA', element: el, owner, subject: `schema:${key}`, message: `${where} has the attribute ${key}, which the BPMN schema does not define${fits ? ` (did you mean ${this.prefix}:${key}?)` : ''}; the engines validate the file against the schema and refuse it`, hint });
      }
    }
  }

  checkSchemaEventDefinitions(reporter: RuleReporter): void {
    for (const def of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      if (!def.is('bpmn:EventDefinition')) {
        continue;
      }
      const parent = def.parent;
      const event = parent && parent.is('bpmn:Event') && parent.id ? parent : undefined;
      const id = event?.id;
      const defs = event?.list('eventDefinitions') ?? [];
      const subject = defs.length > 1 ? `#${defs.indexOf(def)}` : '';
      const fix = (cmd: string, keeps: string): string => {
        if (!id) {
          return 'Fix it in the XML.';
        }
        if (defs.length < 2) {
          return `\`bpmn set <file> ${id} ${cmd}\`${keeps ? ` (${keeps})` : ''}.`;
        }
        const acting = this.actingDefinition(event!);
        const only = `\`bpmn set <file> ${id} ${cmd}\` (keeps only the ${this.triggerName(def)} definition)`;
        if (!acting || acting === def) {
          return `${only}.`;
        }
        return `The engines act on the ${this.triggerName(acting)} definition and ignore this one, but they validate it too: drop it with \`bpmn set <file> ${id} trigger=${this.triggerName(acting)}\` (keeps only the ${this.triggerName(acting)}), or ${only}.`;
      };
      const label = id ? this.describe(event!, undefined) : `${def.type}${def.id ? ` ${def.id}` : ''}`;
      const what = (single: string): string => (defs.length > 1 ? `The ${this.triggerName(def)} definition of ${label}` : id ? `${single} ${id}` : label);
      if (def.is('bpmn:ConditionalEventDefinition') && !def.peek<BpmnElement>('condition')) {
        reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: event ?? def, subject: `condition${subject}`, message: `${what('Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, hint: fix(ShellWords.quote('when=${expression}'), '') });
      } else if (def.is('bpmn:LinkEventDefinition') && (def.peek<string>('name') === undefined || def.peek<string>('name') === null)) {
        reporter.deploy({ code: 'W_C7_DEPLOY_LINK', element: event ?? def, subject: `link:name${subject}`, message: `${what('Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, hint: fix('link=<Name>', 'the throw and the catch event of a pair share the name') });
      } else if (def.is('bpmn:TimerEventDefinition')) {
        const set = CamundaRules.TIMER_ELEMENTS.filter((timerKind) => def.peek<BpmnElement>(timerKind));
        if (set.length < 2) {
          continue;
        }
        reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: event ?? def, subject: `timer:elements${subject}`, message: `${what('Timer event')} has ${set.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, hint: fix('timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go') });
      }
    }
  }
}

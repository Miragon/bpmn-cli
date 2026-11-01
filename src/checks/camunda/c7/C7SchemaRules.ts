import { type BpmnElement, CAMUNDA } from '../../../model/index.js';
import { C7Rules } from './C7Rules.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';
import type { UnprefixedAttributes } from '../rules/CamundaRules.js';
export class C7SchemaRules extends C7Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Definitions')) {
      this.checkSchemaEventDefinitions(reporter);
      this.checkSchemaAttributes(reporter);
    }
  }

  private checkSchemaAttributes(reporter: RuleReporter): void {
    for (const attributes of this.unprefixedAttributes()) {
      for (const key of attributes.keys) {
        this.checkSchemaAttribute(attributes, key, reporter);
      }
    }
  }

  private checkSchemaAttribute(attributes: UnprefixedAttributes, key: string, reporter: RuleReporter): void {
    const { el, owner, id } = attributes;
    const vendor = CAMUNDA.attr(key);
    const fits = !!vendor && vendor.owners.some((ownerType) => el.is(ownerType)) && !!id && el === owner;
    const where = el === owner ? this.describe(el, undefined) : `${el.type}${id ? ` in ${id}` : ''}`;
    reporter.deploy({ code: 'W_C7_DEPLOY_SCHEMA', element: el, owner, subject: `schema:${key}`, message: `${where} has the attribute ${key}, which the BPMN schema does not define${fits ? ` (did you mean ${this.prefix}:${key}?)` : ''}; the engines validate the file against the schema and refuse it`, hint: this.schemaHint(attributes, key, fits) });
  }

  private schemaHint(attributes: UnprefixedAttributes, key: string, fits: boolean): string {
    const { el, id, di, addr } = attributes;
    const implemented = Object.keys(el.attrs ?? {}).some((attributeName) => /^[\w.-]+:(class|delegateExpression|expression|type)$/.test(attributeName) && CAMUNDA.reads(this.ns.uriOfName(attributeName)));
    const link = implemented ? undefined : this.decisionLinkOf(attributes, key);
    if (link) {
      return `Write the decision link in the engines' spelling: \`bpmn set <file> ${id} ${ShellWords.quote(`calledDecision=${link.value}`)}\` (${this.prefix}:decisionRef; the unprefixed ${key} is removed).`;
    }
    if (fits) {
      return `Use the vendor attribute instead: \`bpmn set <file> ${id} ${ShellWords.quote(`${key}=`)} ${ShellWords.quote(`${this.prefix}:${key}=${String(el.attrs[key] ?? '')}`)}\`.`;
    }
    if (addr) {
      return `Remove it: \`bpmn set <file> ${addr.slot(`${key}=`)}\` (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`;
    }
    if (di) {
      return `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram, which writes new diagram elements: \`bpmn layout <file>\` (the hand-made layout is lost).`;
    }
    return `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''} (vendor attributes need their namespace prefix, e.g. ${this.prefix}:<name>).`;
  }

  private checkSchemaEventDefinitions(reporter: RuleReporter): void {
    for (const def of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      if (def.is('bpmn:EventDefinition')) {
        this.checkSchemaEventDefinition(def, reporter);
      }
    }
  }

  private static schemaEventOf(def: BpmnElement): BpmnElement | undefined {
    const parent = def.parent;
    return parent && parent.is('bpmn:Event') && parent.id ? parent : undefined;
  }

  private checkSchemaEventDefinition(def: BpmnElement, reporter: RuleReporter): void {
    const event = C7SchemaRules.schemaEventOf(def);
    const defs = event?.list('eventDefinitions') ?? [];
    const subject = defs.length > 1 ? `#${defs.indexOf(def)}` : '';
    const fix = (cmd: string, keeps: string): string => this.definitionFix(def, event, cmd, keeps);
    const what = (single: string): string => this.definitionLabel(def, event, single);
    if (def.is('bpmn:ConditionalEventDefinition') && !def.peek<BpmnElement>('condition')) {
      reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: event ?? def, subject: `condition${subject}`, message: `${what('Conditional event')} has no condition element, which the BPMN schema requires; the engines refuse the file`, hint: fix(ShellWords.quote('when=${expression}'), '') });
    } else if (def.is('bpmn:LinkEventDefinition') && (def.peek<string>('name') === undefined || def.peek<string>('name') === null)) {
      reporter.deploy({ code: 'W_C7_DEPLOY_LINK', element: event ?? def, subject: `link:name${subject}`, message: `${what('Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`, hint: fix('link=<Name>', 'the throw and the catch event of a pair share the name') });
    } else if (def.is('bpmn:TimerEventDefinition')) {
      C7SchemaRules.checkTimerElements(def, event, subject, what, fix, reporter);
    }
  }

  private static checkTimerElements(def: BpmnElement, event: BpmnElement | undefined, subject: string, what: (single: string) => string, fix: (cmd: string, keeps: string) => string, reporter: RuleReporter): void {
    const set = CamundaRules.TIMER_ELEMENTS.filter((timerKind) => def.peek<BpmnElement>(timerKind));
    if (set.length >= 2) {
      reporter.deploy({ code: 'W_C7_DEPLOY_EVENT_DEFINITION', element: event ?? def, subject: `timer:elements${subject}`, message: `${what('Timer event')} has ${set.join(' and ')}; the BPMN schema allows only one of timeDate, timeCycle and timeDuration, and the engines refuse the file`, hint: fix('timer=<value>', 'R/PT1H is a cycle, PT1H a duration, else a date; the other elements go') });
    }
  }

  private definitionFix(def: BpmnElement, event: BpmnElement | undefined, cmd: string, keeps: string): string {
    const id = event?.id;
    const defs = event?.list('eventDefinitions') ?? [];
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
  }

  private definitionLabel(def: BpmnElement, event: BpmnElement | undefined, single: string): string {
    const id = event?.id;
    const label = id ? this.describe(event!, undefined) : `${def.type}${def.id ? ` ${def.id}` : ''}`;
    if ((event?.list('eventDefinitions') ?? []).length > 1) {
      return `The ${this.triggerName(def)} definition of ${label}`;
    }
    return id ? `${single} ${id}` : label;
  }
}

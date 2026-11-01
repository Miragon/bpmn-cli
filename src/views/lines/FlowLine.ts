import { ElementLine, type ElementRef, type VendorFacts } from './ElementLine.js';
import { Phrase } from './Phrase.js';

export interface FlowTraits {
  name?: string | undefined;
  condition?: string | undefined;
  conditionResource?: string | undefined;
  default?: boolean | undefined;
}

export interface OutgoingFlow extends ElementRef, FlowTraits, VendorFacts {
  target: ElementRef;
  language?: string | undefined;
}

export interface MessageFlowEnds {
  id: string;
  name?: string | undefined;
  source: ElementRef;
  target: ElementRef;
  message?: string | undefined;
}

export class FlowLine {
  private static readonly CONDITION_MAX = 120;

  constructor(private readonly flow: FlowTraits) {}

  static outgoing(flow: OutgoingFlow): string {
    const parts = [flow.id, ...new FlowLine(flow).traits()];
    const flags = [...(flow.language ? [`language=${flow.language}`] : []), ...ElementLine.vendorFlags(flow)];
    return `${flow.target.id} (${[...parts, ...(flags.length ? [`[${flags.join(', ')}]`] : [])].join(' ')})`;
  }

  static message(flow: MessageFlowEnds): string {
    const head = new ElementLine(flow).named;
    return `messageFlow ${head}: ${new ElementLine(flow.source).named} -> ${new ElementLine(flow.target).named}${flow.message ? ` [message ${flow.message}]` : ''}`;
  }

  traits(wholeCondition = false): string[] {
    const { name, condition, conditionResource, default: isDefault } = this.flow;
    const traits = name ? [new Phrase(name).quoted] : [];
    if (condition) {
      traits.push(`if ${wholeCondition ? condition : new Phrase(condition).cut(FlowLine.CONDITION_MAX)}`);
    } else if (conditionResource) {
      traits.push(`if resource ${conditionResource}`);
    }
    return isDefault ? [...traits, 'default'] : traits;
  }
}

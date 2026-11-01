import { ModelChecks } from '../checks/index.js';
import { BpmnError, type BpmnDocument, type Finding } from '../model/index.js';
import { NeighbourhoodView } from './around/index.js';
import { ElementDetail, type ElementDetailData } from './element/index.js';
import { ModelView, type ModelViewData } from './model/index.js';

export interface ShowOptions {
  id?: string | undefined;
  in?: string | undefined;
  around?: string | undefined;
  depth?: number | undefined;
}

export interface ShowResult {
  text: string;
  view: ModelViewData | ElementDetailData;
  state: { errors: number; warnings: number };
}

export class ShowQuery {
  constructor(
    private readonly document: BpmnDocument,
    private readonly options: ShowOptions = {},
  ) {}

  private static counted(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  private static stateOf(findings: readonly Finding[]): ShowResult['state'] {
    const errors = findings.filter(({ severity }) => severity === 'error').length;
    return { errors, warnings: findings.length - errors };
  }

  async answer(): Promise<ShowResult> {
    this.refuseMixedOptions();
    const { text, view } = this.shown();
    const state = ShowQuery.stateOf(await new ModelChecks(this.document).all());
    const stateLine = `state: ${ShowQuery.counted(state.errors, 'error')}, ${ShowQuery.counted(state.warnings, 'warning')} (bpmn validate lists them and runs the project's lint)`;
    return { text: `${text}\n${stateLine}`, view, state };
  }

  private shown(): Pick<ShowResult, 'text' | 'view'> {
    const { id, around, depth, in: within } = this.options;
    if (id !== undefined) {
      return new ElementDetail(this.document).answer(id);
    }
    if (around !== undefined) {
      return new NeighbourhoodView(this.document).answer(around, depth);
    }
    return new ModelView(this.document).answer(within);
  }

  private refuseMixedOptions(): void {
    const { id, around, depth, in: within } = this.options;
    if (around !== undefined && (id !== undefined || within !== undefined)) {
      throw BpmnError.usage(`--around <id> names the element itself; drop ${id !== undefined ? 'the element id' : '--in'}`, { hint: 'Use `bpmn show <file> --around <id> [--depth n]`.' });
    }
    if (id !== undefined && within !== undefined) {
      throw BpmnError.usage('an element id shows one element; drop --in', { hint: 'Use `bpmn show <file> <id>`.' });
    }
    if (depth !== undefined && around === undefined) {
      throw BpmnError.usage('--depth goes only with --around <id>', { hint: 'Use `bpmn show <file> --around <id> --depth <n>`.' });
    }
  }
}

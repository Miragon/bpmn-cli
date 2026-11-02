import { ModelChecks } from '../checks/index.js';
import { DiagramDrawing, type DrawingReport, type DrawnOperation, DrawingSnapshot } from '../drawing/index.js';
import { ModelOperationRunner, type OperationRun } from '../edit/index.js';
import { type BpmnDocument, BpmnError, DocumentReader, DocumentWriter, type Finding, type IdConventions, type ValidatorIssue } from '../model/index.js';
import { OperationParser, type OrderOperation, type ParsedOperations } from '../operations/index.js';
import { DrawnPlane, ElementHomes, type LayoutScore, ScoreChange, Scorer } from '../scoring/index.js';
import { FindingDelta } from './FindingDelta.js';
import { type HostContext, HostValidators, type Validator, type ValidatorRun } from './HostValidators.js';
import { IdRenames } from './IdRenames.js';
import { type EditResult, WriteOutcome } from './WriteOutcome.js';

export interface EditOptions {
  validators?: readonly Validator[] | undefined;
  force?: boolean | undefined;
  conventions?: IdConventions | undefined;
}

export class WriteTransaction {
  private static readonly RETRY_HINT = 'make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway.';

  private readonly scorer = new Scorer();

  constructor(private readonly options: EditOptions = {}) {}

  private static drawnOf({ model, drawing }: OperationRun): { operations: DrawnOperation[]; positions: number[] } {
    const orders = [...model.entries()].filter((entry): entry is [number, OrderOperation] => entry[1].op === 'order');
    return {
      operations: [...orders.map(([, order]) => order), ...drawing],
      positions: [...orders.map(([position]) => position), ...drawing.map((_, position) => model.length + position)],
    };
  }

  private static hostContext(document: BpmnDocument, { model, drawing }: ParsedOperations): HostContext {
    return { platform: document.platform(), file: document.file, operations: [...model, ...drawing], importWarnings: document.reportedImportWarnings };
  }

  private static hostRefusal(errors: readonly ValidatorIssue[]): BpmnError {
    const names = [...new Set(errors.map(({ validator }) => validator))].map((name) => `validator ${name}`);
    return BpmnError.model('E_VALIDATION', `The change would introduce ${errors.length} error(s) reported by ${names.join(', ')}; nothing was written`, {
      errors,
      hint: `Fix the listed problems (each names its validator in brackets), ${WriteTransaction.RETRY_HINT}`,
    });
  }

  private static structureRefusal(errors: readonly Finding[]): BpmnError {
    return BpmnError.model('E_VALIDATION', `The change would introduce ${errors.length} structural error(s); nothing was written`, {
      errors,
      hint: `Fix the listed problems, ${WriteTransaction.RETRY_HINT}`,
    });
  }

  private static async errorsAdded(input: string, checks: readonly Finding[], delta: FindingDelta): Promise<Finding[]> {
    const errors = checks.filter(({ severity }) => severity === 'error');
    if (!errors.length) {
      return [];
    }
    const before = await new DocumentReader().read(input);
    return delta.newErrors(errors, await new ModelChecks(before).onWrite());
  }

  async apply(xml: string, input: unknown): Promise<EditResult> {
    const operations = new OperationParser().parse(input);
    const document = await new DocumentReader().readForWrite(xml);
    document.assertLossless(this.options);
    if (this.options.conventions) {
      document.conventions = this.options.conventions;
    }
    const hosts = new HostValidators(this.options.validators, WriteTransaction.hostContext(document, operations));
    const hostBefore = await hosts.run(xml, 'before');
    try {
      return await this.change(document, operations, xml, hosts, hostBefore);
    } catch (error) {
      throw BpmnError.from(error);
    }
  }

  private async change(document: BpmnDocument, operations: ParsedOperations, input: string, hosts: HostValidators, hostBefore: readonly ValidatorRun[]): Promise<EditResult> {
    const { force } = this.options;
    const snapshot = DrawingSnapshot.of(document);
    const scoreBefore = snapshot.byPlaneElement.size > 0 ? this.scoreOf(document) : undefined;
    const run = new ModelOperationRunner(document, { force }).run(operations);
    const drawing = await this.draw(document, snapshot, run);
    const score = new ScoreChange(scoreBefore, this.scoreOf(document));
    const checks = await new ModelChecks(document).onWrite();
    const renames = new IdRenames(run.changes);
    const delta = new FindingDelta(renames.newIds());
    const addedErrors = await WriteTransaction.errorsAdded(input, checks, delta);
    if (addedErrors.length && !force) {
      throw WriteTransaction.structureRefusal(addedErrors);
    }
    const xml = await new DocumentWriter().write(document, run.changes);
    const host = delta.ofHostValidators(hostBefore, await hosts.run(xml, 'after'));
    if (host.blocking.length && !force) {
      throw WriteTransaction.hostRefusal(host.blocking);
    }
    return new WriteOutcome({ input, xml, run, drawing, renames, checks, addedErrors, host, score }).result();
  }

  private async draw(document: BpmnDocument, snapshot: DrawingSnapshot, run: OperationRun): Promise<DrawingReport> {
    const { operations, positions } = WriteTransaction.drawnOf(run);
    try {
      const report = await new DiagramDrawing(document).update(snapshot, run.changes, operations);
      return { ...report, format: report.format.map((result) => ({ ...result, index: positions[result.index]! })) };
    } catch (error) {
      if (error instanceof BpmnError && error.details.op !== undefined) {
        error.details.op = positions[error.details.op];
      }
      throw error;
    }
  }

  private scoreOf(document: BpmnDocument): LayoutScore {
    return this.scorer.scoreDrawing(DrawnPlane.read(document), new ElementHomes(document));
  }
}

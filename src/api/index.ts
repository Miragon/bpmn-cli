import { DocumentReader, type IdConventions } from '../model/index.js';
import type { OperationInput } from '../operations/index.js';
import { DiagramView, ElementFinder, ImageView, KindTable, ShowQuery, type DiagramResult, type FindOptions, type FindResult, type KindTableResult, type RenderOptions, type RenderedImage, type ShowOptions, type ShowResult } from '../views/index.js';
import { DocumentValidation, NewModel, WriteTransaction, type EditOptions, type EditResult, type NewOptions, type ValidateOptions, type ValidationReport } from '../write/index.js';

export { BpmnError, type Change, type ErrorCategory, type ErrorDetails, type Family, type Finding, type FindingCounts, type IdConventions, type KindDefinition, type Platform, type PlatformInfo, type QualifierMode, type Rename, type Severity, type Suggestion, type Target, type Trigger as TriggerName, type ValidatorFinding, type ValidatorIssue, type ValidatorSeverity } from '../model/index.js';
export { OPS_SCHEMA, type JsonSchema, type OperationInput as Operation } from '../operations/index.js';
export type { FormatResult } from '../drawing/index.js';
export type { CutCount, ElementSummary, ExtensionFacts, FlagSource, Implementation, OutgoingFlow, FlowTraits, MessageFlowEnds, RowFrame, RowFrameKind, VendorFacts, ViewAnnotation, ViewData, ViewLane, ViewNode, ViewParticipant, WideGap, DataLinks, ElementCatch, ElementLane, ElementLink, ElementMessage, ElementRef, EventSubProcessCatch, ExtensionInfo, ModelCut, PartnerFlow, PlaneRows, ViewCollaboration, ViewGroup, ViewProcess, ViewRoot, CropOptions, DiagramFacts, DiagramNote, DiagramNoteKind, DiagramResult, ElementDetailData, FindHit, FindOptions, FindResult, Kind, KindTableResult, ModelViewData, NumberedProblem, RenderOptions, RenderedImage, ShowOptions, ShowResult, SvgImage, TriggerRow as Trigger } from '../views/index.js';
export type { EditOptions, EditResult, LayoutCheck, LayoutProblem, NewOptions, PlatformSummary, ProblemKind, ProblemKindRecord, ProblemKinds, ProblemLocation, RenamedId, ScoreChange, ScoredProblems, ScoreSummary, ValidateOptions, ValidationReport, Validator, ValidatorContext, ValidatorPhase, ValidatorSummary } from '../write/index.js';

export function applyToXml(xml: string, operations: OperationInput[], options: EditOptions = {}): Promise<EditResult> {
  return new WriteTransaction(options).apply(xml, operations);
}

export async function showXml(xml: string, options: ShowOptions = {}): Promise<ShowResult> {
  return new ShowQuery(await new DocumentReader().read(xml), options).answer();
}

export async function findXml(xml: string, options: FindOptions = {}): Promise<FindResult> {
  return new ElementFinder(await new DocumentReader().read(xml), options).answer();
}

export async function diagramXml(xml: string): Promise<DiagramResult> {
  return new DiagramView(await new DocumentReader().read(xml)).answer();
}

export async function renderXml(xml: string, options: RenderOptions = {}): Promise<RenderedImage> {
  return new ImageView(await new DocumentReader().read(xml), options).answer();
}

export function validateXml(xml: string, options: ValidateOptions = {}): Promise<ValidationReport> {
  return new DocumentValidation(options).report(xml);
}

export function newXml(options: NewOptions = {}): Promise<string> {
  return new NewModel(options).xml();
}

export function kindsJson(options: { conventions?: IdConventions } = {}): KindTableResult {
  return new KindTable(options.conventions).answer();
}

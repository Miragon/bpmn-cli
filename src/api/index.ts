import { DocumentReader, type IdConventions } from '../model/index.js';
import type { OperationInput } from '../operations/index.js';
import { DiagramView, ElementFinder, ImageView, KindTable, ShowQuery, type DiagramResult, type FindOptions, type FindResult, type KindTableResult, type RenderOptions, type RenderedImage, type ShowOptions, type ShowResult } from '../views/index.js';
import { DocumentValidation, NewModel, WriteTransaction, type EditOptions, type EditResult, type NewOptions, type ValidateOptions, type ValidationReport } from '../write/index.js';

export { BpmnError, type Change, type CommandWords, type Finding, type IdConventions, type QualifierMode, type Suggestion, type ValidatorFinding } from '../model/index.js';
export { OPS_SCHEMA, type OperationInput as Operation } from '../operations/index.js';
export type { FormatResult } from '../drawing/index.js';
export type { DiagramNote, DiagramResult, ElementDetailData, FindHit, FindOptions, FindResult, KindTableResult, ModelViewData, RenderOptions, RenderedImage, ShowOptions, ShowResult, SvgImage } from '../views/index.js';
export type { EditOptions, EditResult, NewOptions, ScoreDifference, ValidateOptions, ValidationReport, Validator, ValidatorContext, ValidatorSummary } from '../write/index.js';

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

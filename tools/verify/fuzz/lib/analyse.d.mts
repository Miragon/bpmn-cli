export interface AnalysedModel {
  parseError?: string;
}

export function analyse(xml: string): Promise<AnalysedModel>;
export function drawingInvariants(analysis: AnalysedModel): string[];

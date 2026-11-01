export interface AnalysedModel {
  parseError?: string;
}

export function analyse(xml: string): Promise<AnalysedModel>;
export function diInvariants(analysis: AnalysedModel): string[];

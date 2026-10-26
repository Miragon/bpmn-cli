import { is, type El } from '../../document/utils/moddle.js';

export const readIf = (key: string, value: unknown): Record<string, unknown> => (value ? { [key]: value } : {});

export const multiInstanceOf = (el: El): El | undefined => {
  const loop = el.get<El | undefined>('loopCharacteristics');
  return is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? loop : undefined;
};

export const expressionBody = (owner: El | undefined, property: string): string | undefined => owner?.get<El | undefined>(property)?.get<string | undefined>('body');

export const flowConditionOf = (flow: El): El | undefined => flow.get<El | undefined>('conditionExpression');

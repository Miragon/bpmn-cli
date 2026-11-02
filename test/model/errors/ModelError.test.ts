import { describe, expect, it } from 'vitest';
import { ModelError } from '../../../src/model/errors/ModelError.js';

describe('ModelError', () => {
  it('names what the model could not do', () => {
    const error = new ModelError('Root element is not bpmn:Definitions', 'PARSE_ERROR');

    expect([error.name, error.code, error.details]).toEqual(['ModelError', 'PARSE_ERROR', {}]);
  });
});

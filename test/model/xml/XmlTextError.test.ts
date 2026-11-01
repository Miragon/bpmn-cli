import { describe, expect, it } from 'vitest';
import { XmlTextError } from '../../../src/model/xml/XmlTextError.js';

describe('XmlTextError', () => {
  it('says where in the text the XML broke', () => {
    const error = new XmlTextError('a second root element', 42);

    expect([error.name, error.message]).toEqual(['XmlTextError', 'a second root element at offset 42']);
  });
});

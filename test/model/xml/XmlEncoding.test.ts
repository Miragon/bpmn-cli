import { describe, expect, it } from 'vitest';
import { XmlEncoding } from '../../../src/model/xml/XmlEncoding.js';

describe('XmlEncoding', () => {
  it('reads the encoding a declaration names, a BOM before it allowed', () => {
    expect(XmlEncoding.declared('<?xml version="1.0" encoding="ISO-8859-1"?><a/>')).toBe('ISO-8859-1');
    expect(XmlEncoding.declared("﻿<?xml version='1.0' encoding='UTF-8'?><a/>")).toBe('UTF-8');
    expect(XmlEncoding.declared('<a/>')).toBeUndefined();
  });

  it('knows the spellings of UTF-8', () => {
    expect([XmlEncoding.isUtf8(' utf8 '), XmlEncoding.isUtf8('UTF-8'), XmlEncoding.isUtf8('latin1')]).toEqual([true, true, false]);
  });

  it('turns a declaration of another encoding into UTF-8 and tells which it was', () => {
    expect(XmlEncoding.utf8Declaration('<?xml version="1.0" encoding="ISO-8859-1"?><a/>')).toEqual({ text: '<?xml version="1.0" encoding="UTF-8"?><a/>', was: 'ISO-8859-1' });
  });

  it('leaves a UTF-8 file alone', () => {
    const text = '<?xml version="1.0" encoding="UTF-8"?><a/>';

    expect(XmlEncoding.utf8Declaration(text)).toEqual({ text });
  });
});

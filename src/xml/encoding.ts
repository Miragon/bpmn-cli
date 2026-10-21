/**
 * The character encoding of what a write produces.
 *
 * The core works on strings, and every write is UTF-8: the node layer
 * writes the text as UTF-8 (src/node/files.ts), and the in-memory API
 * returns a string a host stores as UTF-8. A file may declare another
 * encoding (`<?xml version="1.0" encoding="ISO-8859-1"?>`); keeping that
 * declaration over UTF-8 bytes would make a parser that honours it read
 * every non-ASCII character of the new text as mojibake. Re-encoding in the
 * declared encoding instead cannot write every character (an ISO-8859-1
 * file has no `€`; names and comments cannot use character references), so
 * the safe choice is the other one:
 *
 * CONTRACT
 *  utf8Declaration(text) returns the text with the encoding of its XML
 *  declaration replaced by `UTF-8` (quote style and everything else kept)
 *  and the encoding it named, when that is not UTF-8; otherwise the text
 *  as it is. The pipeline applies it to a result that differs from the
 *  input (outputText) and notes it; an unchanged result is the input string
 *  itself and is not written, so a no-op keeps the file and its
 *  declaration. The node layer reads a file in the encoding it declares
 *  (src/node/files.ts readXml), so the characters it had survive a write.
 */

/** An XML declaration up to the value of its encoding pseudo-attribute (a UTF-8 BOM before it allowed). */
const DECLARATION = /^(﻿?<\?xml\s[^?>]*?\bencoding\s*=\s*)(["'])([^"']*)\2/;

/** The encoding an XML declaration at the start of `text` names, if any. */
export function declaredEncoding(text: string): string | undefined {
  return DECLARATION.exec(text)?.[3];
}

/** Whether an encoding name means UTF-8. */
export function isUtf8(encoding: string): boolean {
  return /^utf-?8$/i.test(encoding.trim());
}

/** See the module contract. */
export function utf8Declaration(text: string): { text: string; was?: string } {
  const m = DECLARATION.exec(text);
  if (!m || isUtf8(m[3]!)) return { text };
  return { text: `${m[1]}${m[2]}UTF-8${m[2]}${text.slice(m[0].length)}`, was: m[3]! };
}

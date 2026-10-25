/** An XML declaration up to the value of its encoding (a UTF-8 BOM before it allowed). */
const DECLARATION = /^(﻿?<\?xml\s[^?>]*?\bencoding\s*=\s*)(["'])([^"']*)\2/;

export function declaredEncoding(text: string): string | undefined {
  return DECLARATION.exec(text)?.[3];
}

export function isUtf8(encoding: string): boolean {
  return /^utf-?8$/i.test(encoding.trim());
}

/**
 * Every write is UTF-8, so a declaration naming another encoding would turn non-ASCII text
 * into mojibake; re-encoding cannot write every character (ISO-8859-1 has no `€`).
 * Returns the text declaring UTF-8 and the encoding it named before.
 */
export function utf8Declaration(text: string): { text: string; was?: string } {
  const m = DECLARATION.exec(text);
  if (!m || isUtf8(m[3]!)) return { text };
  return { text: `${m[1]}${m[2]}UTF-8${m[2]}${text.slice(m[0].length)}`, was: m[3]! };
}

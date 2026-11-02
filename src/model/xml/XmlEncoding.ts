export class XmlEncoding {
  private static readonly DECLARATION = /^(﻿?<\?xml\s[^?>]*?\bencoding\s*=\s*)(["'])([^"']*)\2/;

  static declared(text: string): string | undefined {
    return XmlEncoding.DECLARATION.exec(text)?.[3];
  }

  static isUtf8(encoding: string): boolean {
    return /^utf-?8$/i.test(encoding.trim());
  }

  static utf8Declaration(text: string): { text: string; was?: string } {
    const match = XmlEncoding.DECLARATION.exec(text);
    if (!match || XmlEncoding.isUtf8(match[3]!)) {
      return { text };
    }
    return { text: `${match[1]}${match[2]}UTF-8${match[2]}${text.slice(match[0].length)}`, was: match[3]! };
  }
}

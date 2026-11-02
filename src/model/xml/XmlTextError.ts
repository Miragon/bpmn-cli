export class XmlTextError extends Error {
  constructor(message: string, at: number) {
    super(`${message} at offset ${at}`);
    this.name = 'XmlTextError';
  }
}

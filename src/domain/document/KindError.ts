export class KindError extends Error {
  constructor(
    message: string,
    public readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = 'KindError';
  }
}

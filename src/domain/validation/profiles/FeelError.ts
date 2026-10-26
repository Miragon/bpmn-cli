export class FeelError extends Error {
  constructor(
    readonly at: number,
    message: string,
  ) {
    super(message);
  }
}

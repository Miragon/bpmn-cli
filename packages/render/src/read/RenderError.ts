export type RenderErrorCode = 'E_PARSE' | 'E_NOT_FOUND' | 'E_WRONG_KIND' | 'E_NO_MATCH' | 'E_RENDER';

export class RenderError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message: string,
    readonly element?: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}

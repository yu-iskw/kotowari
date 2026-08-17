export class WebError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebError';
  }
}

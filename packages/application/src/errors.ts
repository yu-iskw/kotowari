export class ApplicationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ApplicationError';
    this.status = status;
  }
}

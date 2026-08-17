export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerError';
  }
}

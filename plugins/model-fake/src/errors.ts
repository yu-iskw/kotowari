export class ModelFakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelFakeError';
  }
}

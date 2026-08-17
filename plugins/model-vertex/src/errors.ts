export class ModelVertexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelVertexError';
  }
}

export class CapabilityRetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityRetrievalError';
  }
}

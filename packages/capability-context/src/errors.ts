export class CapabilityContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityContextError';
  }
}

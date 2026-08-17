export class CapabilityMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityMemoryError';
  }
}

export class CapabilityOntologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityOntologyError';
  }
}

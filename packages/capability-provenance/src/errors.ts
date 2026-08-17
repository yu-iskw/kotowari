export class CapabilityProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityProvenanceError';
  }
}

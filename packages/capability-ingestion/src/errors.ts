export class CapabilityIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityIngestionError';
  }
}

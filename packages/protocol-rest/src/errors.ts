export class ProtocolRestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolRestError';
  }
}

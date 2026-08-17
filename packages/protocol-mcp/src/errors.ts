export class ProtocolMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolMcpError';
  }
}

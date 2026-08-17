export class AgentCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentCursorError';
  }
}

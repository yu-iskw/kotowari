export class CapabilityKnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityKnowledgeError';
  }
}

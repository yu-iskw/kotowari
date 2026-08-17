export class CapabilityPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityPolicyError';
  }
}

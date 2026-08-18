export class AdapterPostgresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterPostgresError';
  }
}

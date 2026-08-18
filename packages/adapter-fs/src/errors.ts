export class AdapterFsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterFsError';
  }
}

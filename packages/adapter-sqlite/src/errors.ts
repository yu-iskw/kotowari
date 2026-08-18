export class AdapterSqliteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterSqliteError';
  }
}

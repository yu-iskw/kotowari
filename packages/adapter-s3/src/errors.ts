export class AdapterS3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterS3Error';
  }
}

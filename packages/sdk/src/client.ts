export type KotowariClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class KotowariClient {
  readonly context = {
    build: async (input: {
      purpose: string;
      query?: string;
      subject?: { type: string; id: string };
    }): Promise<unknown> => this.request('POST', '/v1/context/build', input),
  };

  readonly decisions = {
    record: async (input: {
      purpose: string;
      selectedOutcome: string;
      confidence: number;
      query?: string;
      rationale?: string;
    }): Promise<unknown> => this.request('POST', '/v1/decisions', input),
  };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KotowariClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<unknown> {
    return this.request('GET', '/v1/health');
  }

  async searchKnowledge(input: { query: string; purpose?: string }): Promise<unknown> {
    return this.request('POST', '/v1/knowledge/search', input);
  }

  async ingest(input: {
    path?: string;
    text?: string;
    relativePath?: string;
    mimeType?: string;
  }): Promise<unknown> {
    return this.request('POST', '/v1/ingest', input);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json();
  }
}

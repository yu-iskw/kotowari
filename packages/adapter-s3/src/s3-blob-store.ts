import { createHash, createHmac } from 'node:crypto';

import { AdapterS3Error } from './errors.js';

import type { BlobStore } from '@kotowari/plugin-sdk';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const S3_SERVICE = 's3';
const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';
const AWS_REQUEST = 'aws4_request';
const HEADER_CONTENT_TYPE = 'content-type';
const HEADER_HOST = 'host';
const HEADER_AMZ_CONTENT_SHA256 = 'x-amz-content-sha256';
const HEADER_AMZ_DATE = 'x-amz-date';
const SIGNED_HEADERS = `${HEADER_CONTENT_TYPE};${HEADER_HOST};${HEADER_AMZ_CONTENT_SHA256};${HEADER_AMZ_DATE}`;

export type S3BlobStoreOptions = {
  endpoint: string; // e.g. http://127.0.0.1:9000
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // default us-east-1
};

export type SignS3RequestInput = {
  method: string;
  url: string;
  body: Uint8Array;
  contentType: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type SignedS3Headers = {
  Authorization: string;
  'content-type': string;
  'x-amz-content-sha256': string;
  'x-amz-date': string;
};

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function formatAmzDate(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function objectUrl(endpoint: string, bucket: string, key: string): string {
  const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  return `${base}/${bucket}/${encodeObjectKey(key)}`;
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, S3_SERVICE);
  return hmacSha256(kService, AWS_REQUEST);
}

function failStatus(operation: string, status: number): never {
  throw new AdapterS3Error(`S3 ${operation} failed with status ${String(status)}`);
}

export function signS3Request(input: SignS3RequestInput): SignedS3Headers {
  const parsed = new URL(input.url);
  const host = parsed.host;
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const contentType = input.contentType.trim();
  const canonicalHeaders =
    `${HEADER_CONTENT_TYPE}:${contentType}\n` +
    `${HEADER_HOST}:${host}\n` +
    `${HEADER_AMZ_CONTENT_SHA256}:${payloadHash}\n` +
    `${HEADER_AMZ_DATE}:${amzDate}\n`;
  const canonicalRequest =
    `${input.method.toUpperCase()}\n` +
    `${parsed.pathname}\n` +
    `\n` +
    `${canonicalHeaders}\n` +
    `${SIGNED_HEADERS}\n` +
    payloadHash;
  const credentialScope = `${dateStamp}/${input.region}/${S3_SERVICE}/${AWS_REQUEST}`;
  const stringToSign =
    `${AWS_ALGORITHM}\n` + `${amzDate}\n` + `${credentialScope}\n` + sha256Hex(canonicalRequest);
  const signature = hmacSha256(
    deriveSigningKey(input.secretAccessKey, dateStamp, input.region),
    stringToSign,
  ).toString('hex');
  return {
    Authorization: `${AWS_ALGORITHM} Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
}

class S3BlobStore implements BlobStore {
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly options: Required<S3BlobStoreOptions>) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ uri: string }> {
    const uri = objectUrl(this.options.endpoint, this.options.bucket, key);
    await this.ensureBucket();
    const response = await this.send('PUT', uri, bytes, contentType);
    await response.arrayBuffer();
    if (!response.ok) {
      failStatus('PUT', response.status);
    }
    return { uri };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    const uri = objectUrl(this.options.endpoint, this.options.bucket, key);
    const response = await this.send('GET', uri, new Uint8Array(), DEFAULT_CONTENT_TYPE);
    if (response.status === 404) {
      await response.arrayBuffer();
      return undefined;
    }
    if (!response.ok) {
      failStatus('GET', response.status);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get(HEADER_CONTENT_TYPE) ?? DEFAULT_CONTENT_TYPE,
    };
  }

  private async send(
    method: 'GET' | 'PUT',
    url: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<Response> {
    const headers = signS3Request({
      method,
      url,
      body,
      contentType,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.options.region,
    });
    return fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? body : undefined,
    });
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady === undefined) {
      this.bucketReady = this.createBucket();
    }
    await this.bucketReady;
  }

  private async createBucket(): Promise<void> {
    const base = this.options.endpoint.endsWith('/')
      ? this.options.endpoint.slice(0, -1)
      : this.options.endpoint;
    const url = `${base}/${this.options.bucket}`;
    const response = await this.send('PUT', url, new Uint8Array(), DEFAULT_CONTENT_TYPE);
    await response.arrayBuffer();
  }
}

export function createS3BlobStore(options: S3BlobStoreOptions): BlobStore {
  return new S3BlobStore({
    endpoint: options.endpoint,
    bucket: options.bucket,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region ?? DEFAULT_REGION,
  });
}

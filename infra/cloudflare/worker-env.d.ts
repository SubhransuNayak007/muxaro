/**
 * Ambient type definitions for Cloudflare Workers & R2 Storage
 */

declare global {
  interface R2Object {
    key: string;
    size: number;
    httpEtag?: string;
    uploaded?: Date;
    range?: { offset: number; length: number };
    httpMetadata?: {
      contentType?: string;
      contentLanguage?: string;
      contentDisposition?: string;
      contentEncoding?: string;
      cacheControl?: string;
      cacheExpiry?: Date;
    };
  }

  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
    blob(): Promise<Blob>;
  }

  interface R2GetOptions {
    range?: any;
    onlyIf?: any;
  }

  interface R2Bucket {
    get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | R2Object | null>;
    put(key: string, value: any, options?: any): Promise<R2Object>;
    delete(keys: string | string[]): Promise<void>;
    head(key: string): Promise<R2Object | null>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }
}

export {};

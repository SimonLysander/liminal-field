import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { ExternalCacheEntry } from './external-cache.entity';

export interface ExternalCacheKey {
  namespace: string;
  operation: string;
  key: Record<string, unknown>;
}

export interface ExternalCacheError {
  kind: string;
  message: string;
  retryable?: boolean;
  provider?: string;
  statusCode?: number;
}

export type ExternalCacheEntryLike = Pick<
  ExternalCacheEntry,
  | '_id'
  | 'namespace'
  | 'operation'
  | 'key'
  | 'keyHash'
  | 'status'
  | 'payload'
  | 'error'
  | 'meta'
  | 'createdAt'
  | 'updatedAt'
  | 'expiresAt'
>;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

export function buildExternalCacheId(
  namespace: string,
  operation: string,
  key: Record<string, unknown>,
): string {
  const raw = `${namespace}:${operation}:${stableStringify(key)}`;
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class ExternalCacheRepository {
  constructor(
    @Inject(getModelToken(ExternalCacheEntry.name))
    private readonly model: ReturnModelType<typeof ExternalCacheEntry>,
  ) {}

  async getFresh(
    input: ExternalCacheKey,
    now = new Date(),
  ): Promise<ExternalCacheEntryLike | null> {
    return this.model
      .findOne({
        _id: buildExternalCacheId(input.namespace, input.operation, input.key),
        expiresAt: { $gt: now },
      })
      .lean<ExternalCacheEntryLike | null>();
  }

  async setOk(
    input: ExternalCacheKey,
    payload: unknown,
    meta: Record<string, unknown>,
    expiresAt: Date,
    now = new Date(),
  ): Promise<void> {
    await this.upsert(input, 'ok', payload, null, meta, expiresAt, now);
  }

  async setError(
    input: ExternalCacheKey,
    error: ExternalCacheError,
    meta: Record<string, unknown>,
    expiresAt: Date,
    now = new Date(),
  ): Promise<void> {
    await this.upsert(input, 'error', null, error, meta, expiresAt, now);
  }

  private async upsert(
    input: ExternalCacheKey,
    status: 'ok' | 'error',
    payload: unknown,
    error: ExternalCacheError | null,
    meta: Record<string, unknown>,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    const keyHash = buildExternalCacheId(
      input.namespace,
      input.operation,
      input.key,
    );
    await this.model.findOneAndUpdate(
      { _id: keyHash },
      {
        $set: {
          namespace: input.namespace,
          operation: input.operation,
          key: input.key,
          keyHash,
          status,
          payload,
          error,
          meta,
          updatedAt: now,
          expiresAt,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }
}

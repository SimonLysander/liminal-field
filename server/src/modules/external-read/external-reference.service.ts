import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac } from 'crypto';
import { z } from 'zod';

const referenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cursor'),
    context: z.string(),
    revision: z.string(),
    offset: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('section'),
    target: z.string(),
    revision: z.string(),
    index: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('asset'),
    target: z.string(),
    revision: z.string(),
    fileName: z.string().min(1).max(255),
  }),
]);
export type ExternalReference = z.infer<typeof referenceSchema>;
export function revisionOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class ExternalReferenceService {
  private readonly jwt = new JwtService();
  private readonly secret: string;

  constructor() {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
    // Public references must never validate as admin login tokens.
    this.secret = createHmac('sha256', process.env.JWT_SECRET)
      .update('liminal-field/external-reader/v1')
      .digest('hex');
  }

  encode(reference: ExternalReference): string {
    return this.jwt.sign(reference, {
      secret: this.secret,
      algorithm: 'HS256',
      audience: 'external-reader',
      noTimestamp: true,
    });
  }

  decode(reference: string): ExternalReference {
    if (reference.length > 4096)
      throw new BadRequestException('INVALID_REFERENCE');
    try {
      return referenceSchema.parse(
        this.jwt.verify<Record<string, unknown>>(reference, {
          secret: this.secret,
          algorithms: ['HS256'],
          audience: 'external-reader',
        }),
      );
    } catch {
      throw new BadRequestException('INVALID_REFERENCE');
    }
  }

  offset(
    cursor: string | undefined,
    context: string,
    revision: string,
  ): number {
    if (!cursor) return 0;
    const ref = this.decode(cursor);
    if (ref.kind !== 'cursor' || ref.context !== context)
      throw new BadRequestException('INVALID_CURSOR');
    this.assertRevision(ref.revision, revision);
    return ref.offset;
  }

  assertRevision(referenceRevision: string, currentRevision: string): void {
    if (referenceRevision !== currentRevision)
      throw new ConflictException('CONTENT_CHANGED');
  }

  page<T>(
    items: T[],
    limit: number,
    cursor: string | undefined,
    context: string,
  ) {
    const revision = revisionOf(items);
    const offset = this.offset(cursor, context, revision);
    if (offset > items.length) throw new BadRequestException('INVALID_CURSOR');
    const end = Math.min(offset + limit, items.length);
    return {
      items: items.slice(offset, end),
      total: items.length,
      revision,
      nextCursor:
        end < items.length
          ? this.encode({ kind: 'cursor', context, revision, offset: end })
          : null,
    };
  }
}

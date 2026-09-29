import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

const publicCodes = new Set([
  'INVALID_ARGUMENT',
  'INVALID_TARGET',
  'INVALID_REFERENCE',
  'INVALID_CURSOR',
  'INVALID_SECTION',
  'CONTENT_TARGET_REQUIRED',
  'CONTENT_CHANGED',
  'RESOURCE_NOT_FOUND',
  'REPRESENTATION_UNAVAILABLE',
  'ASSET_NOT_ARCHIVED',
  'ASSET_READ_FAILED',
]);

export function externalReadError(error: unknown): {
  status: number;
  code: string;
} {
  const status = error instanceof HttpException ? error.getStatus() : 500;
  const candidate = error instanceof Error ? error.message.split(':')[0] : '';
  // Both transports hide the existence of private items and internal error details.
  const code =
    status === 404
      ? 'RESOURCE_NOT_FOUND'
      : publicCodes.has(candidate)
        ? candidate
        : status < 500
          ? 'INVALID_ARGUMENT'
          : 'INTERNAL_ERROR';
  return { status, code };
}

@Catch()
export class ExternalReadFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExternalReadFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const { status, code } = externalReadError(error);
    if (status >= 500)
      this.logger.error(
        { event: 'external_read_failed', status, code },
        error instanceof Error ? error.stack : undefined,
      );
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .header('Cache-Control', 'no-store')
      .status(status)
      .send({ code: status, msg: code, data: null, error: { code } });
  }
}

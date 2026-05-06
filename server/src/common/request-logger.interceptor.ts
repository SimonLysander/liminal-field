import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Nest 异常或携带 status/statusCode 的底层错误 */
function statusFromError(err: unknown): number {
  if (err instanceof HttpException) return err.getStatus();
  if (err && typeof err === 'object') {
    const o = err as { status?: unknown; statusCode?: unknown };
    if (typeof o.status === 'number') return o.status;
    if (typeof o.statusCode === 'number') return o.statusCode;
  }
  return 500;
}

/**
 * 替代 Fastify 默认的 JSON 请求日志，输出人类可读的单行格式：
 *   GET /api/v1/auth/check → 200 (12ms)
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const reply = context.switchToHttp().getResponse<FastifyReply>();
          const duration = Date.now() - startTime;
          this.logger.log(
            `${method} ${url} → ${reply.statusCode} (${duration}ms)`,
          );
        },
        error: (err: unknown) => {
          const duration = Date.now() - startTime;
          const status = statusFromError(err);
          this.logger.warn(`${method} ${url} → ${status} (${duration}ms)`);
        },
      }),
    );
  }
}

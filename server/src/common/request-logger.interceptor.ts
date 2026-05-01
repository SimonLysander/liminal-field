import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
          this.logger.log(`${method} ${url} → ${reply.statusCode} (${duration}ms)`);
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const status = error?.status ?? error?.statusCode ?? 500;
          this.logger.warn(`${method} ${url} → ${status} (${duration}ms)`);
        },
      }),
    );
  }
}

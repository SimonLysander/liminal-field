import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiResponse } from './response-wrapper.interceptor';

/**
 * 全局异常过滤器：所有异常统一为 { code, msg, data: null }
 *
 * code 规则：
 *   - HttpException → HTTP 状态码作为 code（400、404、500 等）
 *   - 未知异常     → 500
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    let httpStatus: number;
    let msg: string;

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      const response = exception.getResponse();
      msg =
        typeof response === 'string'
          ? response
          : (((response as Record<string, unknown>).message as string) ??
            exception.message);
      // class-validator 会返回 message 数组
      if (Array.isArray(msg)) msg = (msg as string[]).join('; ');
    } else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      msg = 'Internal server error';
      this.logger.error('Unhandled exception', exception);
    }

    const body: ApiResponse<null> = {
      code: httpStatus,
      msg,
      data: null,
    };

    reply.status(httpStatus).send(body);
  }
}

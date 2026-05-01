import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RAW_RESPONSE_KEY } from './raw-response.decorator';

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/**
 * 全局响应包装：所有成功响应统一为 { code: 0, msg: 'ok', data: ... }
 *
 * 标记 @RawResponse() 的端点跳过包装（如文件下载）。
 * 异常由 AllExceptionsFilter 包装。
 */
@Injectable()
export class ResponseWrapperInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isRaw = this.reflector.get<boolean>(
      RAW_RESPONSE_KEY,
      context.getHandler(),
    );
    if (isRaw) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        code: 0,
        msg: 'ok',
        data: data ?? null,
      })),
    );
  }
}

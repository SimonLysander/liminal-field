import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseWrapperInterceptor } from './common/response-wrapper.interceptor';
import { RequestLoggerInterceptor } from './common/request-logger.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  // 使用 Fastify 适配器
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // 关闭 Fastify 自带的请求日志（JSON 格式不可读），
      // 由 RequestLoggerInterceptor 输出人类可读的单行格式。
      disableRequestLogging: true,
      logger: {
        ...(isProduction
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'HH:mm:ss',
                  ignore: 'pid,hostname',
                  singleLine: true,
                },
              },
            }),
      },
    }),
  );

  // 1. 服务接口参数校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // 2. 统一响应包装 + 请求日志
  app.useGlobalInterceptors(
    new RequestLoggerInterceptor(),
    new ResponseWrapperInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Cookie 解析——JwtAuthGuard 从 auth_token cookie 读取 JWT。
  await app.register(cookie);

  // 附件上传：fileSize 200MB 覆盖 MinerU 精准 API 的文件上限。
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // 2. 服务和路由
  app.setGlobalPrefix('api/v1');
  const port = parseInt(process.env.PORT ?? '4398', 10);
  await app.listen(port, '0.0.0.0');

  console.log(`Server is running on: ${await app.getUrl()}`);
}

void bootstrap();

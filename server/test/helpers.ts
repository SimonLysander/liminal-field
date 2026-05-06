/**
 * E2E 测试工具函数。
 *
 * 提供：
 * - TestContext：封装单个测试套件的生命周期（MongoMemoryServer + 临时 Git 仓库 + NestJS app）
 * - login：登录并返回 auth cookie 字符串
 * - createNoteItem / createGalleryItem：快速创建测试用内容条目
 *
 * 关键设计决策：
 * - 不导入 AppModule（它会尝试读取 configs/db.yaml 连接生产 MongoDB），
 *   而是手动组装 TestAppModule，覆盖 TypegooseModule 连接为内存 MongoDB。
 * - 临时 Git 仓库通过环境变量 CONTENT_REPO_ROOT 传给 ConfigService。
 * - MinioService 完全 mock 为 jest.fn()（草稿资源功能在 E2E 中不测）。
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { TypegooseModule } from 'nestjs-typegoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import simpleGit from 'simple-git';
import supertest from 'supertest';

import { AuthModule } from '../src/modules/auth/auth.module';
import { ContentModule } from '../src/modules/content/content.module';
import { NavigationModule } from '../src/modules/navigation/navigation.module';
import { WorkspaceModule } from '../src/modules/workspace/workspace.module';
import { MinioModule } from '../src/modules/minio/minio.module';
import { MinioService } from '../src/modules/minio/minio.service';
import { ResponseWrapperInterceptor } from '../src/common/response-wrapper.interceptor';
import { RequestLoggerInterceptor } from '../src/common/request-logger.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/**
 * 封装单个测试套件的 MongoDB + Git + NestJS app 生命周期。
 * 在 beforeAll 中调用 setup()，在 afterAll 中调用 teardown()。
 */
export class TestContext {
  mongod!: MongoMemoryServer;
  app!: NestFastifyApplication;
  tmpGitDir!: string;

  async setup(): Promise<void> {
    // ─── 1. 启动内存 MongoDB（下载/解压可能很慢，与 jest-e2e testTimeout 对齐）───
    this.mongod = await MongoMemoryServer.create({
      startTimeout: 120_000,
    });
    const mongoUri = this.mongod.getUri();

    // ─── 2. 创建临时 Git 仓库（ContentGitService 在 onModuleInit 中会完成分支初始化） ───
    this.tmpGitDir = await mkdtemp(join(tmpdir(), 'lf-test-'));
    const git = simpleGit(this.tmpGitDir);
    await git.init();
    // git commit 需要 user.name / user.email，容器内没有全局配置
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');

    // ─── 3. 设置必要的环境变量 ───
    process.env.JWT_SECRET = 'test-secret-for-e2e';
    process.env.ADMIN_PASSWORD = 'test-password';

    // ─── 4. 创建测试模块 ───
    // 不使用 AppModule（内嵌 yamlLoader 读取 configs/db.yaml），
    // 而是手动组装，通过 ConfigModule.forRoot load 函数注入测试配置。
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // load 函数返回的配置会覆盖 yaml 文件，ConfigService.get() 从此处读取
          load: [
            () => ({
              content: {
                repoRoot: this.tmpGitDir,
              },
              // minio 配置需要存在（MinioService 构造器里调 getOrThrow），
              // 但会被 overrideProvider 完全替换，值本身不生效
              minio: {
                endpoint: 'localhost',
                port: 9000,
                useSSL: false,
                accessKey: 'test',
                secretKey: 'test',
                bucket: 'test-bucket',
              },
            }),
          ],
        }),
        // TypegooseModule 直接连内存 MongoDB，跳过 yaml 配置中的生产 URI
        TypegooseModule.forRoot(mongoUri),
        ScheduleModule.forRoot(),
        MinioModule,
        AuthModule,
        ContentModule,
        NavigationModule,
        WorkspaceModule,
      ],
    })
      // MinioService.onModuleInit 会尝试连真实 MinIO，E2E 中完全 mock 掉
      .overrideProvider(MinioService)
      .useValue({
        onModuleInit: jest.fn(),
        uploadDraftAsset: jest.fn().mockResolvedValue('mock-file.jpg'),
        getDraftAsset: jest.fn().mockResolvedValue({
          buffer: Buffer.alloc(0),
          contentType: 'image/jpeg',
        }),
        deleteDraftAssets: jest.fn().mockResolvedValue(undefined),
        // moveDraftAssetsToDisk 返回空数组：commit 时没有草稿资源需要落盘
        moveDraftAssetsToDisk: jest.fn().mockResolvedValue([]),
        putObject: jest.fn().mockResolvedValue(undefined),
        getObject: jest.fn().mockResolvedValue(Buffer.alloc(0)),
        listByPrefix: jest.fn().mockResolvedValue([]),
        removeByPrefix: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    this.app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    // ─── 5. 注册与 main.ts 一致的全局配置 ───
    this.app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    this.app.useGlobalInterceptors(
      new RequestLoggerInterceptor(),
      new ResponseWrapperInterceptor(this.app.get(Reflector)),
    );
    this.app.useGlobalFilters(new AllExceptionsFilter());

    await this.app.register(cookie);
    await this.app.register(multipart, {
      limits: { fileSize: 200 * 1024 * 1024 },
    });
    this.app.setGlobalPrefix('api/v1');

    await this.app.init();
    // Fastify 需要等 ready() 才能接受请求
    await this.app.getHttpAdapter().getInstance().ready();
  }

  async teardown(): Promise<void> {
    if (this.app) await this.app.close();
    if (this.mongod) await this.mongod.stop();
    if (this.tmpGitDir)
      await rm(this.tmpGitDir, { recursive: true, force: true });
  }
}

/**
 * 登录并返回 auth cookie 字符串（格式：'auth_token=xxx'）。
 * 后续请求在 .set('Cookie', cookie) 中使用。
 */
export async function login(app: NestFastifyApplication): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ password: 'test-password' })
    .expect(201);

  // Fastify set-cookie 可能是字符串或字符串数组
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) {
    throw new Error('Login failed: no set-cookie header');
  }
  // 取第一个 cookie 的 name=value 部分（忽略 httpOnly/path 等属性）
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr.split(';')[0];
}

/**
 * 创建一个 notes 内容条目，返回其 ID。
 */
export async function createNoteItem(
  app: NestFastifyApplication,
  cookie: string,
  title = '测试笔记',
): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/spaces/notes/items')
    .set('Cookie', cookie)
    .send({ title })
    .expect(201);

  return res.body.data.id;
}

/**
 * 创建一个 gallery 内容条目，返回其 ID。
 */
export async function createGalleryItem(
  app: NestFastifyApplication,
  cookie: string,
  title = '测试相册',
): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/spaces/gallery/items')
    .set('Cookie', cookie)
    .send({ title })
    .expect(201);

  return res.body.data.id;
}

/**
 * 提交 notes 内容（写入 main.md + git commit）。
 * 返回提交后的 contentDetail，其中包含 latestVersion.commitHash。
 */
export async function commitNoteContent(
  app: NestFastifyApplication,
  cookie: string,
  id: string,
  bodyMarkdown = '# 标题\n\n测试内容正文。',
  title = '测试笔记',
): Promise<any> {
  const res = await supertest(app.getHttpServer())
    .put(`/api/v1/spaces/notes/items/${id}`)
    .set('Cookie', cookie)
    .send({
      title,
      summary: title,
      status: 'committed',
      bodyMarkdown,
      changeNote: '初始提交',
      action: 'commit',
    })
    .expect(200);

  return res.body.data;
}

/**
 * 提交 gallery 内容（写入 frontmatter main.md + git commit）。
 * photos 需要包含至少一张照片（file 字段必须对应 assets 目录中已存在的文件）。
 */
export async function commitGalleryContent(
  app: NestFastifyApplication,
  cookie: string,
  id: string,
  options: {
    title?: string;
    prose?: string;
    photos?: Array<{
      file: string;
      caption: string;
      tags?: Record<string, string>;
    }>;
    changeNote?: string;
  } = {},
): Promise<any> {
  const res = await supertest(app.getHttpServer())
    .put(`/api/v1/spaces/gallery/items/${id}`)
    .set('Cookie', cookie)
    .send({
      title: options.title ?? '测试相册',
      prose: options.prose ?? '',
      photos: options.photos ?? [],
      changeNote: options.changeNote ?? '初始提交',
    })
    .expect(200);

  return res.body.data;
}

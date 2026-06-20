/**
 * digest-workflow.e2e-spec.ts — Digest 工作流 E2E 测试。
 *
 * 覆盖：
 * Case 1: POST /digest/topics/:topicId/run-now 创建 task（taskId 格式 + 状态可查）
 * Case 2: 完整 workflow 跑通（mock LLM + mock RssFetcher）
 * Case 3: findings=0 早停（task.status=failed + error）
 * Case 4: GET /digest/topics/:id/tasks 列最近（倒序）
 * Case 5: 未登录返回 401
 *
 * Mock 策略：
 * - generateText / generateObject：jest.mock('ai')，只 mock LLM 调用不改任何 DB/Git 逻辑
 * - RssFetcher.prototype.fetch：jest.spyOn，返回固定 2 条 FetchedItem
 * - 其余全用真服务（NestJS 全模块启动，连接内存 MongoDB + 临时 Git）
 *
 * 注意：jest.mock('ai') 必须在文件顶部（jest 会 hoist mock 调用到 import 之前），
 * 随后 import 的 generateText/generateObject 就是 jest mock function。
 */

// ─── LLM mock（必须在所有 import 之前声明，jest hoist 会提升到顶部）────────
jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: jest.fn(),
    generateObject: jest.fn(),
  };
});

// mock OpenAI compatible provider（react-agent.node 和 compose.node 构建时用到）
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => ({})),
  })),
}));

// mock makeRepairToolCall（react-agent.node 依赖，不影响测试目的）
jest.mock('../src/modules/agent/agent.utils', () => ({
  makeRepairToolCall: jest.fn(() => jest.fn()),
}));

import supertest from 'supertest';
import { generateText, generateObject } from 'ai';
import { TestContext, login } from './helpers';
import { DigestModule } from '../src/modules/digest/digest.module';
import { RssFetcher } from '../src/modules/digest/fetchers/rss-fetcher.service';
// PromptManagerModule 是 @Global()，AppModule 一次注入后全局可用；
// TestContext 手动组装不含 AppModule，需要显式传入 extraModules。
import { PromptManagerModule } from '../src/infrastructure/prompt/prompt-manager.module';
// SettingsModule 提供 SystemConfigService（DigestModule → ReactAgentNode/ComposeNode 依赖）
import { SettingsModule } from '../src/modules/settings/settings.module';
import type { FetchedItem } from '../src/modules/digest/fetchers/fetcher.interface';

// 强类型 mock：避免在 test body 里反复 as any
const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;
const mockGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>;

// ─── 固定 mock 数据 ───────────────────────────────────────────────────────────

// publishedAt 设为"昨天"和"前天"，确保通过 browse 工具的 since=7天前 过滤
// （不能用固定日期，否则随时间推移会变成 7 天前之前的历史数据被过滤掉）
const YESTERDAY = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
const DAY_BEFORE = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const MOCK_FEED_ITEMS: FetchedItem[] = [
  {
    itemGuid: 'mock-item-1',
    title: 'Mock 文章 1',
    url: 'https://mock.example.com/1',
    publishedAt: YESTERDAY,
    snippet: '这是 mock 摘要 1，涵盖 e2e 测试核心主题。',
  },
  {
    itemGuid: 'mock-item-2',
    title: 'Mock 文章 2',
    url: 'https://mock.example.com/2',
    publishedAt: DAY_BEFORE,
    snippet: '这是 mock 摘要 2，补充背景资料。',
  },
];

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 创建一条信息源（RSS type），返回其 id（src_xxx）。
 */
async function createInfoSource(
  app: import('@nestjs/platform-fastify').NestFastifyApplication,
  cookie: string,
  name = 'E2E Mock RSS 源',
): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/info-sources')
    .set('Cookie', cookie)
    .send({
      type: 'rss',
      name,
      config: { url: 'https://mock.example.com/rss.xml' },
      enabled: true,
    })
    .expect(201);

  return res.body.data.id as string;
}

/**
 * 创建一个采集事项，返回其 contentItemId（ci_xxx）。
 * TopicService.create 同时建 NavigationNode + ContentItem + SmartTopicConfig。
 */
async function createTopic(
  app: import('@nestjs/platform-fastify').NestFastifyApplication,
  cookie: string,
  sourceId: string,
  name = 'E2E 测试事项',
): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/digest/topics')
    .set('Cookie', cookie)
    .send({
      name,
      cron: '0 * * * *',
      sourceIds: [sourceId],
      keywords: ['e2e', 'test'],
      prompt: '收集与 e2e 测试相关的内容。',
      enabled: true,
    })
    .expect(201);

  return res.body.data.id as string;
}

/**
 * 轮询 GET /digest/tasks/:taskId 直到 status 不为 running 或超时。
 * 超时返回最后一次的 task dto，由 caller 自行断言（而非在 helper 里 throw）。
 */
async function waitForTaskDone(
  app: import('@nestjs/platform-fastify').NestFastifyApplication,
  cookie: string,
  taskId: string,
  timeoutMs = 5000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: any = null;

  while (Date.now() < deadline) {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/digest/tasks/${taskId}`)
      .set('Cookie', cookie)
      .expect(200);

    lastBody = res.body.data;
    if (lastBody.status !== 'running') {
      return lastBody;
    }
    // 每 100ms 轮询一次
    await new Promise((r) => setTimeout(r, 100));
  }

  return lastBody;
}

// ─── Case 1: run-now 创建 task ────────────────────────────────────────────────

describe('Digest Case 1: POST /digest/topics/:topicId/run-now 创建 task', () => {
  let ctx: TestContext;
  let cookie: string;
  let topicId: string;

  beforeAll(async () => {
    ctx = new TestContext();
    // DigestModule 依赖 SettingsModule（SystemConfigService.getAiConfig）
    // SettingsModule 已通过 DigestModule → import SettingsModule 间接引入，
    // 但 TestContext.setup 不含 SettingsModule；这里通过 extraModules 显式加入。
    await ctx.setup([PromptManagerModule, SettingsModule, DigestModule]);
    cookie = await login(ctx.app);

    const sourceId = await createInfoSource(ctx.app, cookie);
    topicId = await createTopic(ctx.app, cookie, sourceId);

    // Case 1 只验 taskId 格式 + 状态可查，不需要 workflow 真跑完
    // mock generateText/generateObject 返回极简假值，防止真跑 LLM 或 throw
    mockGenerateText.mockResolvedValue({ steps: [], text: '' } as any);
    mockGenerateObject.mockResolvedValue({
      object: { headline: 'noop', markdown: '## noop' },
    } as any);
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('响应 202，body.data.taskId 匹配 /^dt_/', async () => {
    const res = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    expect(res.body.code).toBe(0);
    expect(res.body.data.taskId).toMatch(/^dt_/);
  });

  it('等 100ms 后 GET task 返回合法状态（running / done / failed）', async () => {
    const runRes = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    const taskId = runRes.body.data.taskId as string;

    await new Promise((r) => setTimeout(r, 100));

    const taskRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/digest/tasks/${taskId}`)
      .set('Cookie', cookie)
      .expect(200);

    const status = taskRes.body.data.status as string;
    expect(['running', 'done', 'failed']).toContain(status);
  });

  it('topic 不存在时 → 404', async () => {
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/digest/topics/ci_nonexistent123/run-now')
      .set('Cookie', cookie)
      .expect(404);
  });
});

// ─── Case 2: 完整 workflow 跑通（mock LLM + fetcher）─────────────────────────

describe('Digest Case 2: 完整 workflow 跑通（mock LLM）', () => {
  let ctx: TestContext;
  let cookie: string;
  let topicId: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([PromptManagerModule, SettingsModule, DigestModule]);
    cookie = await login(ctx.app);

    // ─── mock RssFetcher.fetch：每次调用返回唯一 guid 的 FetchedItem（避免 PFI 去重）───
    // 同一 TestContext 内多次 run-now 会把上一次 pick 的 guid 写入 ProcessedFeedItem，
    // 导致下一次 browse 时去重后 items 为空。用自增 suffix 确保每次 guid 不同。
    let fetchCallCount = 0;
    fetchSpy = jest
      .spyOn(RssFetcher.prototype, 'fetch')
      .mockImplementation(() => {
        fetchCallCount++;
        return Promise.resolve([
          {
            itemGuid: `mock-item-1-r${fetchCallCount}`,
            title: 'Mock 文章 1',
            url: 'https://mock.example.com/1',
            publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            snippet: '这是 mock 摘要 1，涵盖 e2e 测试核心主题。',
          },
          {
            itemGuid: `mock-item-2-r${fetchCallCount}`,
            title: 'Mock 文章 2',
            url: 'https://mock.example.com/2',
            publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            snippet: '这是 mock 摘要 2，补充背景资料。',
          },
        ]);
      });

    const sourceId = await createInfoSource(ctx.app, cookie, 'e2e-workflow-源');
    topicId = await createTopic(ctx.app, cookie, sourceId, 'e2e-workflow-事项');

    // ─── mock generateText：模拟 agent 调了 list_sources → browse → pick ───
    mockGenerateText.mockImplementation(async ({ tools }: any) => {
      if (!tools) throw new Error('tools missing in generateText mock');

      // 步骤 1: list_sources（拿 sourceRef）
      const listResult = await tools.list_sources.execute({}, {} as any);
      const parsedList = JSON.parse(listResult) as {
        meta: { sources: Array<{ ref: string }> };
      };
      const sourceRef = parsedList.meta.sources[0]?.ref;
      if (!sourceRef) throw new Error('list_sources returned no sources');

      // 步骤 2: browse（拿 item refs）
      const browseResult = await tools.browse.execute(
        { source: sourceRef },
        {} as any,
      );
      const parsedBrowse = JSON.parse(browseResult) as {
        meta: { items: Array<{ ref: string }> };
      };
      const items = parsedBrowse.meta.items;
      if (!items || items.length === 0)
        throw new Error('browse returned no items');

      // 步骤 3: pick 所有拉到的 items
      await tools.pick.execute(
        {
          items: items.slice(0, 2).map((i: { ref: string }) => ({
            ref: i.ref,
            reason: 'e2e mock 挑这条',
          })),
        },
        {} as any,
      );

      return { steps: [{}, {}, {}], text: 'done' } as any;
    });

    // ─── mock generateObject：compose 节点用 ───
    mockGenerateObject.mockResolvedValue({
      object: {
        headline: 'e2e 测试本期',
        markdown:
          '## 概要\n\n本期内容 [CIT 1] 与 [CIT 2]。\n\n这是 e2e 自动生成的报告正文。',
      },
    } as any);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await ctx.teardown();
  });

  it('完整 workflow：task.status=done，findingsCount=2，reportContentItemId 存在', async () => {
    const runRes = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    const taskId = runRes.body.data.taskId as string;

    // 轮询等 workflow 完成（最多 5s）
    const task = await waitForTaskDone(ctx.app, cookie, taskId, 5000);

    expect(task.status).toBe('done');
    expect(task.findingsCount).toBe(2);
    expect(task.reportContentItemId).toBeTruthy();
    expect(task.reportContentItemId).toMatch(/^ci_/);
  });

  it('task.reportSummary 包含 compose 写入的内容摘要', async () => {
    const runRes = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    const taskId = runRes.body.data.taskId as string;
    const task = await waitForTaskDone(ctx.app, cookie, taskId, 5000);
    expect(task.status).toBe('done');

    // reportSummary 是 markdown 前 200 字，应包含 compose 写入的 "## 概要"
    expect(task.reportSummary).toBeTruthy();
    expect(task.reportSummary).toContain('## 概要');
    // reportContentItemId 不为 null 且格式正确
    expect(task.reportContentItemId).toMatch(/^ci_/);
  });

  it('事项的 NavigationNode 下有子报告节点（通过 topic detail reportCount 验证）', async () => {
    // 先触发一次 workflow
    const runRes = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    const taskId = runRes.body.data.taskId as string;
    const task = await waitForTaskDone(ctx.app, cookie, taskId, 5000);
    expect(task.status).toBe('done');

    // 通过事项详情确认 reportCount >= 1（CommitNode 写入了子 NavigationNode）
    const detailRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/digest/topics/${topicId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(detailRes.body.data.reportCount).toBeGreaterThanOrEqual(1);

    // 通过 structure-path 找到事项的 NavigationNode id，再查子节点列表
    const pathRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/contents/${topicId}/structure-path`)
      .set('Cookie', cookie)
      .expect(200);

    expect(pathRes.body.data.length).toBeGreaterThan(0);
    const topicNavNodeId = pathRes.body.data[pathRes.body.data.length - 1]
      .id as string;

    // visibility=all 确保 committed（未发布）的 digest 报告节点也被列出
    const childrenRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/structure-nodes?parentId=${topicNavNodeId}&visibility=all`)
      .set('Cookie', cookie)
      .expect(200);

    // StructureListResultDto.children 是子节点数组
    expect(childrenRes.body.data.children.length).toBeGreaterThan(0);
  });
});

// ─── Case 3: findings=0 早停 ──────────────────────────────────────────────────

describe('Digest Case 3: findings=0 早停', () => {
  let ctx: TestContext;
  let cookie: string;
  let topicId: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([PromptManagerModule, SettingsModule, DigestModule]);
    cookie = await login(ctx.app);

    fetchSpy = jest
      .spyOn(RssFetcher.prototype, 'fetch')
      .mockResolvedValue(MOCK_FEED_ITEMS);

    const sourceId = await createInfoSource(
      ctx.app,
      cookie,
      'e2e-early-stop-源',
    );
    topicId = await createTopic(
      ctx.app,
      cookie,
      sourceId,
      'e2e-early-stop-事项',
    );

    // mock generateText：只调 list_sources + browse，**不调 pick**
    // → findings 保持 0 → workflow 早停 → status=failed
    mockGenerateText.mockImplementation(async ({ tools }: any) => {
      if (!tools) throw new Error('tools missing in generateText mock');

      const listResult = await tools.list_sources.execute({}, {} as any);
      const parsedList = JSON.parse(listResult) as {
        meta: { sources: Array<{ ref: string }> };
      };
      const sourceRef = parsedList.meta.sources[0]?.ref;
      if (sourceRef) {
        await tools.browse.execute({ source: sourceRef }, {} as any);
      }
      // 不调 pick → findings 为空

      return { steps: [{}, {}], text: 'no picks' } as any;
    });

    mockGenerateObject.mockResolvedValue({
      object: { headline: 'noop', markdown: '## noop' },
    } as any);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await ctx.teardown();
  });

  it('findings=0 → task.status=failed，error 包含"无 findings"', async () => {
    const runRes = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);

    const taskId = runRes.body.data.taskId as string;
    const task = await waitForTaskDone(ctx.app, cookie, taskId, 5000);

    expect(task.status).toBe('failed');
    expect(typeof task.error).toBe('string');
    expect((task.error as string).toLowerCase()).toContain('findings');
  });
});

// ─── Case 4: GET /digest/topics/:id/tasks 列最近（倒序）────────────────────

describe('Digest Case 4: GET /digest/topics/:id/tasks 列最近', () => {
  let ctx: TestContext;
  let cookie: string;
  let topicId: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([PromptManagerModule, SettingsModule, DigestModule]);
    cookie = await login(ctx.app);

    fetchSpy = jest
      .spyOn(RssFetcher.prototype, 'fetch')
      .mockResolvedValue(MOCK_FEED_ITEMS);

    const sourceId = await createInfoSource(
      ctx.app,
      cookie,
      'e2e-list-tasks-源',
    );
    topicId = await createTopic(
      ctx.app,
      cookie,
      sourceId,
      'e2e-list-tasks-事项',
    );

    // 简单 mock：不 pick → 快速早停（只测 list，不关心 done/failed）
    mockGenerateText.mockResolvedValue({ steps: [], text: '' } as any);
    mockGenerateObject.mockResolvedValue({
      object: { headline: 'noop', markdown: '## noop' },
    } as any);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await ctx.teardown();
  });

  it('run-now 2 次，GET tasks 返回 ≥ 2 个，按 startedAt 倒序', async () => {
    // 触发第 1 次
    const run1 = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);
    const taskId1 = run1.body.data.taskId as string;

    // 等一小会儿确保 startedAt 不同（MongoMemoryServer Date 精度足够）
    await new Promise((r) => setTimeout(r, 20));

    // 触发第 2 次
    const run2 = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .set('Cookie', cookie)
      .expect(202);
    const taskId2 = run2.body.data.taskId as string;

    // 等两个任务都结束
    await waitForTaskDone(ctx.app, cookie, taskId1, 5000);
    await waitForTaskDone(ctx.app, cookie, taskId2, 5000);

    const listRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/digest/topics/${topicId}/tasks`)
      .set('Cookie', cookie)
      .expect(200);

    const tasks = listRes.body.data as Array<{
      id: string;
      startedAt: string;
      status: string;
    }>;

    expect(tasks.length).toBeGreaterThanOrEqual(2);

    // 验证列表中包含刚创建的 2 个 task
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(taskId1);
    expect(ids).toContain(taskId2);

    // 验证按 startedAt 倒序（第一个的 startedAt >= 第二个的 startedAt）
    const times = tasks.map((t) => new Date(t.startedAt).getTime());
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }
  });
});

// ─── Case 5: 未登录 → 401 ────────────────────────────────────────────────────

describe('Digest Case 5: 未登录 → 401', () => {
  let ctx: TestContext;
  let cookie: string;
  let topicId: string;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([PromptManagerModule, SettingsModule, DigestModule]);
    cookie = await login(ctx.app);

    mockGenerateText.mockResolvedValue({ steps: [], text: '' } as any);
    mockGenerateObject.mockResolvedValue({
      object: { headline: 'noop', markdown: '## noop' },
    } as any);

    const sourceId = await createInfoSource(ctx.app, cookie, 'e2e-401-源');
    topicId = await createTopic(ctx.app, cookie, sourceId, 'e2e-401-事项');
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('POST run-now 不带 cookie → 401', async () => {
    await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/digest/topics/${topicId}/run-now`)
      .expect(401);
  });

  it('GET /digest/tasks/:taskId 不带 cookie → 401', async () => {
    await supertest(ctx.app.getHttpServer())
      .get('/api/v1/digest/tasks/dt_nonexistent')
      .expect(401);
  });

  it('GET /digest/topics/:id/tasks 不带 cookie → 401', async () => {
    await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/digest/topics/${topicId}/tasks`)
      .expect(401);
  });

  it('POST /info-sources 不带 cookie → 401', async () => {
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/info-sources')
      .send({
        type: 'rss',
        name: '未登录',
        config: { url: 'https://x.com/rss' },
      })
      .expect(401);
  });
});

/**
 * 所有者身份 + 记忆管理 + 会话任务 E2E 测试。
 *
 * 覆盖：
 * - GET  /settings/owner-profile        — 读取所有者信息
 * - PUT  /settings/owner-profile        — 保存所有者信息
 * - GET  /agent/memories                — 列出所有记忆
 * - PUT  /agent/memories/:id            — 更新记忆
 * - DELETE /agent/memories/:id          — 删除记忆
 * - GET  /agent/sessions/:key           — 加载会话（含 tasks）
 * - PUT  /agent/sessions/:key           — 保存会话，返回 tasks
 * （SSE 端点 /agent/sub-agent-progress 不适合 supertest，手动验证）
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';
import { AgentMemoryRepository } from '../src/modules/agent/memory/agent-memory.repository';

describe('Owner Profile & Memory Management (E2E)', () => {
  const ctx = new TestContext();
  let cookie: string;

  beforeAll(async () => {
    await ctx.setup();
    cookie = await login(ctx.app);
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ── 所有者身份 ──

  describe('GET /settings/owner-profile', () => {
    it('首次应返回空的所有者信息', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/owner-profile')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toEqual({
        name: '',
        birthday: '',
        bio: '',
      });
    });
  });

  describe('PUT /settings/owner-profile', () => {
    it('应能保存所有者信息', async () => {
      await supertest(ctx.app.getHttpServer())
        .put('/api/v1/settings/owner-profile')
        .set('Cookie', cookie)
        .send({
          name: 'lux-stirring',
          birthday: '2000-01-15',
          bio: '前端开发、摄影',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/owner-profile')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.name).toBe('lux-stirring');
      expect(res.body.data.birthday).toBe('2000-01-15');
      expect(res.body.data.bio).toBe('前端开发、摄影');
    });

    it('应支持部分更新', async () => {
      await supertest(ctx.app.getHttpServer())
        .put('/api/v1/settings/owner-profile')
        .set('Cookie', cookie)
        .send({ bio: '摄影、写作' })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/owner-profile')
        .set('Cookie', cookie)
        .expect(200);

      // bio 更新了，其他字段保持不变
      expect(res.body.data.name).toBe('lux-stirring');
      expect(res.body.data.birthday).toBe('2000-01-15');
      expect(res.body.data.bio).toBe('摄影、写作');
    });

    it('所有者信息应出现在 config view 中', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/config')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.owner).toBeDefined();
      expect(res.body.data.owner.name).toBe('lux-stirring');
    });
  });

  // ── 记忆管理 ──

  let memoryId: string;

  describe('GET /agent/memories', () => {
    it('初始应返回空列表', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/agent/memories')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });

  describe('Memory CRUD via API', () => {
    it('通过 repository 创建记忆后应能通过 API 列出', async () => {
      // 通过 repository 创建测试记忆（E2E 测管理接口，不测 agent chat）
      const memoryRepo = ctx.app.get(AgentMemoryRepository);
      const doc = await memoryRepo.upsert({
        type: 'user',
        title: '测试记忆',
        content: '用户喜欢喝咖啡',
      });
      memoryId = (doc._id as any).toString();

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/agent/memories')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe('测试记忆');
      expect(res.body.data[0].type).toBe('user');
    });

    it('PUT /agent/memories/:id 应能更新记忆', async () => {
      // 只更新 content;type 保持 user(project 类型已废弃,记忆类型不再由管理端切换)
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/agent/memories/${memoryId}`)
        .set('Cookie', cookie)
        .send({ content: '用户喜欢喝红茶' })
        .expect(200);

      expect(res.body.data.content).toBe('用户喜欢喝红茶');
      expect(res.body.data.type).toBe('user');
      expect(res.body.data.title).toBe('测试记忆'); // title 未改
    });

    it('DELETE /agent/memories/:id 应能删除记忆', async () => {
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/agent/memories/${memoryId}`)
        .set('Cookie', cookie)
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/agent/memories')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.length).toBe(0);
    });
  });

  // ── 会话 tasks（#103） ──

  describe('Session tasks', () => {
    const testSessionKey = 'test-task-session';

    it('GET session 应返回 tasks 字段', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/agent/sessions/${testSessionKey}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.tasks).toEqual([]);
    });

    it('GET session 加载时应包含 write_tasks 写入的 tasks', async () => {
      // 后端权威对话上下文改造后,前端不再 PUT 整段会话;tasks 落在 session 记忆记录
      // (by agentKey=testSessionKey),由 write_tasks 工具写入。这里用 memoryRepo.setTasks
      // 模拟工具写入路径,然后通过 GET session 校验 tasks 被一并下发。
      const memoryRepo = ctx.app.get(AgentMemoryRepository);
      await memoryRepo.setTasks(testSessionKey, [
        {
          id: 'task_001',
          title: '写第一章',
          description: '',
          status: 'pending',
          createdAt: new Date().toISOString(),
          completedAt: null,
        },
      ]);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/agent/sessions/${testSessionKey}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.tasks).toBeInstanceOf(Array);
      expect(res.body.data.tasks.length).toBe(1);
      expect(res.body.data.tasks[0].id).toBe('task_001');
      expect(res.body.data.tasks[0].title).toBe('写第一章');
    });
  });

  // SSE 端点 /agent/sub-agent-progress 不用 supertest 测试（SSE 长连接不适合 request/response 模型），
  // 通过手动集成测试验证。
});

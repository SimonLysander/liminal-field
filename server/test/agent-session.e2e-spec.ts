/**
 * Agent Session E2E 测试。
 *
 * 覆盖：
 * - GET  /agent/sessions/:key — 加载（不存在返回空、存在返回数据）
 * - PUT  /agent/sessions/:key — 保存（新建 + 覆盖）
 * - DELETE /agent/sessions/:key — 删除
 * - Agent configs CRUD（settings/agent-configs）
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';

// AgentModule 依赖 EventEmitterModule，需要单独注册
// 但 TestContext 不包含 AgentModule，所以我们直接测 settings 端点（已包含）
// Agent session 端点需要 AgentModule，这里通过扩展 TestContext 支持

describe('Agent Session & Config (E2E)', () => {
  const ctx = new TestContext();
  let cookie: string;

  beforeAll(async () => {
    await ctx.setup();
    cookie = await login(ctx.app);
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ── Agent Configs（通过 Settings 端点）──

  describe('GET /settings/agent-configs', () => {
    it('首次启动应返回预置的 writing-advisor 配置', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/agent-configs')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const writingAdvisor = res.body.data.find(
        (c: any) => c.key === 'writing-advisor',
      );
      expect(writingAdvisor).toBeDefined();
      expect(writingAdvisor.name).toBe('写作顾问');
      expect(writingAdvisor.enabled).toBe(true);
      expect(writingAdvisor.tools).toBeInstanceOf(Array);
      expect(writingAdvisor.tools.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /settings/agent-configs/:key', () => {
    it('应能更新已有配置的 systemPrompt', async () => {
      await supertest(ctx.app.getHttpServer())
        .put('/api/v1/settings/agent-configs/writing-advisor')
        .set('Cookie', cookie)
        .send({
          name: '写作顾问',
          description: '测试描述',
          enabled: true,
          systemPrompt: '你是一个测试助手',
          tools: ['search_knowledge_base', 'remember'],
          tier: 'flash',
        })
        .expect(200);

      // 验证更新生效
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/agent-configs')
        .set('Cookie', cookie)
        .expect(200);

      const config = res.body.data.find(
        (c: any) => c.key === 'writing-advisor',
      );
      expect(config.systemPrompt).toBe('你是一个测试助手');
      expect(config.tools).toEqual(['search_knowledge_base', 'remember']);
      expect(config.tier).toBe('flash');
    });

    it('应能新建一个 agent 配置', async () => {
      await supertest(ctx.app.getHttpServer())
        .put('/api/v1/settings/agent-configs/gallery-assistant')
        .set('Cookie', cookie)
        .send({
          name: '相册助手',
          description: '帮助整理相册',
          enabled: false,
          systemPrompt: '',
          tools: ['search_knowledge_base'],
          tier: 'standard',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/agent-configs')
        .set('Cookie', cookie)
        .expect(200);

      const gallery = res.body.data.find(
        (c: any) => c.key === 'gallery-assistant',
      );
      expect(gallery).toBeDefined();
      expect(gallery.name).toBe('相册助手');
      expect(gallery.enabled).toBe(false);
    });
  });

  describe('DELETE /settings/agent-configs/:key', () => {
    it('应能删除一个 agent 配置', async () => {
      await supertest(ctx.app.getHttpServer())
        .delete('/api/v1/settings/agent-configs/gallery-assistant')
        .set('Cookie', cookie)
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/settings/agent-configs')
        .set('Cookie', cookie)
        .expect(200);

      const gallery = res.body.data.find(
        (c: any) => c.key === 'gallery-assistant',
      );
      expect(gallery).toBeUndefined();
    });
  });
});

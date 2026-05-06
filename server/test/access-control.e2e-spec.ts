/**
 * access-control.e2e-spec.ts — 访问控制 E2E 测试
 *
 * 覆盖：
 * - 未登录列表只看已发布
 * - 未登录详情只看已发布版内容
 * - 未登录 PUT（提交/发布）→ 401
 * - 未登录 POST 创建 → 401
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
} from './helpers';

describe('Access Control (e2e)', () => {
  let ctx: TestContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup();
    cookie = await login(ctx.app);
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('未登录 GET /spaces/notes/items', () => {
    it('只返回已发布的笔记', async () => {
      // 创建已发布和未发布各一条
      const publishedId = await createNoteItem(
        ctx.app,
        cookie,
        '访问控制已发布笔记',
      );
      await commitNoteContent(
        ctx.app,
        cookie,
        publishedId,
        '# 标题\n\n已发布内容。',
        '访问控制已发布笔记',
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${publishedId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      const unpublishedId = await createNoteItem(
        ctx.app,
        cookie,
        '访问控制未发布笔记',
      );
      await commitNoteContent(
        ctx.app,
        cookie,
        unpublishedId,
        '# 标题\n\n未发布内容。',
        '访问控制未发布笔记',
      );

      // 无 cookie 请求列表
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(publishedId);
      expect(ids).not.toContain(unpublishedId);
    });
  });

  describe('未登录 GET /spaces/notes/items/:id', () => {
    it('已发布笔记 → 200，返回已发布版内容', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制详情已发布');
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 标题\n\n访问控制内容。',
        '访问控制详情已发布',
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}`)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      // 无 cookie 返回 public 视图，不含管理字段
      expect(res.body.data.bodyMarkdown).toContain('访问控制内容');
    });

    it('未发布笔记 → 404', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制详情未发布');
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 标题\n\n未发布。',
        '访问控制详情未发布',
      );

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}`)
        .expect(404);
    });
  });

  describe('未登录写操作 → 401', () => {
    it('未登录 PUT /spaces/notes/items/:id（提交）→ 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制写入测试');
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .send({
          title: '测试',
          summary: '测试',
          status: 'committed',
          bodyMarkdown: '# 标题\n\n内容。',
          changeNote: '提交',
          action: 'commit',
        })
        .expect(401);
    });

    it('未登录 POST /spaces/notes/items → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/items')
        .send({ title: '未登录创建' })
        .expect(401);
    });

    it('未登录 DELETE /spaces/notes/items/:id → 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制删除测试');
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/items/${id}`)
        .expect(401);
    });

    it('未登录 PUT /spaces/notes/items/:id/publish → 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制发布测试');
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .send({})
        .expect(401);
    });

    it('未登录 POST /structure-nodes → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .send({ name: '未登录节点', type: 'FOLDER', scope: 'notes' })
        .expect(401);
    });
  });

  describe('已登录可访问管理接口', () => {
    it('带 cookie 可以访问 visibility=all 的详情', async () => {
      const id = await createNoteItem(ctx.app, cookie, '管理端访问测试');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      // 管理端视图包含 latestVersion
      expect(res.body.data.latestVersion).toBeDefined();
    });
  });
});

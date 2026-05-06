/**
 * notes-draft.e2e-spec.ts — 笔记草稿 CRUD E2E 测试
 *
 * 覆盖：获取草稿（无/有）、保存草稿、删除草稿。
 */
import supertest from 'supertest';
import { TestContext, login, createNoteItem } from './helpers';

describe('Notes Draft (e2e)', () => {
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

  describe('GET /api/v1/spaces/notes/items/:id/draft', () => {
    it('无草稿时返回 null（200，不是 404）', async () => {
      const id = await createNoteItem(ctx.app, cookie, '草稿测试笔记');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toBeNull();
    });
  });

  describe('PUT /api/v1/spaces/notes/items/:id/draft', () => {
    it('保存草稿 → 200，返回草稿内容', async () => {
      const id = await createNoteItem(ctx.app, cookie, '草稿保存测试');

      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '草稿标题',
          summary: '草稿摘要',
          bodyMarkdown: '# 草稿\n\n草稿内容。',
          changeNote: '自动保存',
        })
        .expect(200);

      expect(res.body.code).toBe(0);
      expect(res.body.data.title).toBe('草稿标题');
      expect(res.body.data.bodyMarkdown).toBe('# 草稿\n\n草稿内容。');
      expect(res.body.data.savedAt).toBeDefined();
    });
  });

  describe('GET /api/v1/spaces/notes/items/:id/draft（有草稿）', () => {
    it('保存后 GET 返回刚保存的草稿', async () => {
      const id = await createNoteItem(ctx.app, cookie, '草稿获取测试');

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '保存的草稿标题',
          summary: '摘要',
          bodyMarkdown: '# 草稿正文\n\n内容在这里。',
          changeNote: '自动保存',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).not.toBeNull();
      expect(res.body.data.title).toBe('保存的草稿标题');
      expect(res.body.data.bodyMarkdown).toBe('# 草稿正文\n\n内容在这里。');
    });

    it('重复保存草稿只保留最新一份', async () => {
      const id = await createNoteItem(ctx.app, cookie, '草稿覆盖测试');

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '第一版草稿',
          summary: '摘要',
          bodyMarkdown: '第一版。',
          changeNote: '保存',
        })
        .expect(200);

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '第二版草稿',
          summary: '摘要',
          bodyMarkdown: '第二版。',
          changeNote: '保存',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.title).toBe('第二版草稿');
    });
  });

  describe('DELETE /api/v1/spaces/notes/items/:id/draft', () => {
    it('删除草稿 → 200，之后 GET 返回 null', async () => {
      const id = await createNoteItem(ctx.app, cookie, '草稿删除测试');

      // 先保存草稿
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '待删除草稿',
          summary: '摘要',
          bodyMarkdown: '待删除内容。',
          changeNote: '保存',
        })
        .expect(200);

      // 删除草稿
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .expect(200);

      // GET 返回 null
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/draft`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toBeNull();
    });
  });

  describe('草稿接口的访问控制', () => {
    it('未登录 GET 草稿 → 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制草稿测试');
      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/draft`)
        .expect(401);
    });

    it('未登录 PUT 草稿 → 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '访问控制草稿保存测试');
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/draft`)
        .send({
          title: '草稿',
          summary: '摘要',
          bodyMarkdown: '内容',
          changeNote: '保存',
        })
        .expect(401);
    });
  });
});

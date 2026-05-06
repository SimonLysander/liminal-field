/**
 * notes-publish.e2e-spec.ts — 笔记发布/取消发布 E2E 测试
 *
 * 覆盖：发布、取消发布、指定历史版本发布、访问控制（未登录只看已发布）。
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
} from './helpers';

describe('Notes Publish (e2e)', () => {
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

  describe('PUT /api/v1/spaces/notes/items/:id/publish', () => {
    it('创建 + 提交 → 发布 → status=published', async () => {
      const id = await createNoteItem(ctx.app, cookie, '发布测试笔记');
      await commitNoteContent(ctx.app, cookie, id);

      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      expect(res.body.data.status).toBe('published');
      expect(res.body.data.publishedVersion).toBeDefined();
      expect(res.body.data.publishedVersion.commitHash).toBeTruthy();
    });

    it('未提交就发布 → 400', async () => {
      const id = await createNoteItem(ctx.app, cookie, '未提交发布测试');
      // 不 commit，直接发布

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(400);
    });

    it('发布指定 commitHash → publishedVersion 指向该版本', async () => {
      const id = await createNoteItem(ctx.app, cookie, '指定版本发布测试');
      const v1 = await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# V1\n\n第一版内容。',
        '指定版本发布测试',
      );
      const v1Hash = v1.latestVersion.commitHash;

      // 提交第二版
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '指定版本发布测试',
          summary: '指定版本发布测试',
          status: 'committed',
          bodyMarkdown: '# V2\n\n第二版内容。',
          changeNote: '第二版',
          action: 'commit',
        })
        .expect(200);

      // 发布第一版
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({ commitHash: v1Hash })
        .expect(200);

      expect(res.body.data.publishedVersion.commitHash).toBe(v1Hash);
    });
  });

  describe('PUT /api/v1/spaces/notes/items/:id/unpublish', () => {
    it('已发布 → 取消发布 → publishedVersion=null', async () => {
      const id = await createNoteItem(ctx.app, cookie, '取消发布测试');
      await commitNoteContent(ctx.app, cookie, id);
      // 先发布
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 取消发布
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/unpublish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      expect(res.body.data.publishedVersion).toBeNull();
    });
  });

  describe('未登录访问控制', () => {
    it('已发布笔记 → 无 cookie 可访问，返回已发布版内容', async () => {
      const id = await createNoteItem(ctx.app, cookie, '公开笔记');
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 标题\n\n公开内容。',
        '公开笔记',
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 无 cookie 访问已发布笔记
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}`)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      expect(res.body.data.bodyMarkdown).toContain('公开内容');
    });

    it('未发布笔记 → 无 cookie 访问 → 404', async () => {
      const id = await createNoteItem(ctx.app, cookie, '私有笔记');
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 私有\n\n私有内容。',
        '私有笔记',
      );
      // 不发布

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}`)
        .expect(404);
    });

    it('无 cookie 的列表请求只返回已发布笔记', async () => {
      // 创建一个已发布、一个未发布的笔记
      const publishedId = await createNoteItem(
        ctx.app,
        cookie,
        '已发布列表笔记',
      );
      await commitNoteContent(
        ctx.app,
        cookie,
        publishedId,
        '# 标题\n\n内容。',
        '已发布列表笔记',
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${publishedId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      const unpublishedId = await createNoteItem(
        ctx.app,
        cookie,
        '未发布列表笔记',
      );
      await commitNoteContent(
        ctx.app,
        cookie,
        unpublishedId,
        '# 标题\n\n内容。',
        '未发布列表笔记',
      );

      // 无 cookie 列表请求
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(publishedId);
      expect(ids).not.toContain(unpublishedId);
    });
  });
});

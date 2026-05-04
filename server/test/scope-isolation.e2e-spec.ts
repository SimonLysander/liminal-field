/**
 * scope-isolation.e2e-spec.ts — scope 隔离 E2E 测试
 *
 * 验证 notes 条目不能通过 gallery 路由访问，反之亦然。
 * WorkspaceService.assertScopeMatch 负责此校验，跨 scope 操作应返回 404。
 */
import supertest from 'supertest';
import { TestContext, login, createNoteItem, createGalleryItem } from './helpers';

describe('Scope Isolation (e2e)', () => {
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

  describe('跨 scope 访问应返回 404', () => {
    it('notes 条目通过 /gallery/items/:id 访问 → 404', async () => {
      const noteId = await createNoteItem(ctx.app, cookie, 'scope 隔离测试笔记');

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${noteId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('gallery 条目通过 /notes/items/:id 访问 → 404', async () => {
      const galleryId = await createGalleryItem(ctx.app, cookie, 'scope 隔离测试相册');

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${galleryId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('gallery 条目通过 /notes/items/:id/publish 发布 → 404', async () => {
      const galleryId = await createGalleryItem(ctx.app, cookie, 'scope 隔离发布测试');

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${galleryId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(404);
    });

    it('notes 条目通过 /gallery/items/:id/publish 发布 → 404', async () => {
      const noteId = await createNoteItem(ctx.app, cookie, 'scope 隔离 gallery 发布测试');

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${noteId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(404);
    });

    it('notes 条目通过 /gallery/items/:id DELETE → 404', async () => {
      const noteId = await createNoteItem(ctx.app, cookie, 'scope 隔离删除测试');

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/gallery/items/${noteId}`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('gallery 条目通过 /notes/items/:id DELETE → 404', async () => {
      const galleryId = await createGalleryItem(ctx.app, cookie, 'scope 隔离 gallery 删除测试');

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/items/${galleryId}`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('同 scope 访问正常', () => {
    it('notes 条目通过 /notes/items/:id 可以访问', async () => {
      const noteId = await createNoteItem(ctx.app, cookie, '正常 notes 访问测试');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${noteId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(noteId);
    });

    it('gallery 条目通过 /gallery/items/:id 可以访问', async () => {
      const galleryId = await createGalleryItem(ctx.app, cookie, '正常 gallery 访问测试');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${galleryId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(galleryId);
    });
  });
});

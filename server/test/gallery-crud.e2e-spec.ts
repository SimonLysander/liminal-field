/**
 * gallery-crud.e2e-spec.ts — 画廊基本 CRUD E2E 测试
 *
 * 覆盖：创建相册、管理端列表/详情、展示端列表、删除。
 */
import supertest from 'supertest';
import { TestContext, login, createGalleryItem } from './helpers';

describe('Gallery CRUD (e2e)', () => {
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

  describe('POST /api/v1/spaces/gallery/items', () => {
    it('创建相册 → 201，返回 id 和 title', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/gallery/items')
        .set('Cookie', cookie)
        .send({ title: 'CRUD 测试相册' })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toMatch(/^ci_/);
      expect(res.body.data.title).toBe('CRUD 测试相册');
    });

    it('未登录创建 → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/gallery/items')
        .send({ title: '未登录相册' })
        .expect(401);
    });
  });

  describe('GET /api/v1/spaces/gallery/items（管理端）', () => {
    it('管理端带 cookie 列表包含相册（GalleryAdminListItem 格式）', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '管理端列表测试相册');

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/gallery/items')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.code).toBe(0);
      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(id);

      // 管理端 DTO 应有 status 字段
      const target = res.body.data.find((item: any) => item.id === id);
      expect(target).toHaveProperty('status');
      expect(target).toHaveProperty('photoCount');
    });
  });

  describe('GET /api/v1/spaces/gallery/items/:id（管理端详情）', () => {
    it('visibility=all → 返回管理端详情（GalleryAdminDetail），含 status/publishedCommitHash', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '管理端详情测试');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('publishedCommitHash');
    });

    it('不存在的 ID → 404', async () => {
      await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/gallery/items/ci_nonexistent123?visibility=all')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('GET /api/v1/spaces/gallery/items（展示端）', () => {
    it('无 cookie → 只返回已发布相册（GalleryPublicListItem 格式）', async () => {
      // 展示端格式不含 status/photoCount 管理字段
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/gallery/items')
        .expect(200);

      expect(res.body.code).toBe(0);
      // 展示端 DTO 不含 status
      for (const item of res.body.data) {
        expect(item).not.toHaveProperty('status');
        expect(item).not.toHaveProperty('photoCount');
      }
    });
  });

  describe('DELETE /api/v1/spaces/gallery/items/:id', () => {
    it('删除存在的相册 → 200，之后列表中消失', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '待删除相册');

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/gallery/items/${id}`)
        .set('Cookie', cookie)
        .expect(200);

      // 删除后从管理端列表消失
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/gallery/items')
        .set('Cookie', cookie)
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).not.toContain(id);
    });

    it('未登录删除 → 401', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '未登录删除测试');
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/gallery/items/${id}`)
        .expect(401);
    });
  });
});

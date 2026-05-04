/**
 * navigation.e2e-spec.ts — 导航结构节点 E2E 测试
 *
 * 覆盖：创建文件夹/DOC、scope 过滤、更新、删除（含级联统计）。
 */
import supertest from 'supertest';
import { TestContext, login, createNoteItem, createGalleryItem } from './helpers';

describe('Navigation (e2e)', () => {
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

  describe('POST /api/v1/structure-nodes', () => {
    it('创建文件夹节点（type=FOLDER）→ 201', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({
          name: '测试文件夹',
          type: 'FOLDER',
          scope: 'notes',
        })
        .expect(201);

      expect(res.body.data.name).toBe('测试文件夹');
      expect(res.body.data.type).toBe('FOLDER');
      expect(res.body.data.id).toBeDefined();
    });

    it('创建 DOC 节点（不传 contentItemId，后端自动创建 content item）→ 201', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({
          name: '自动创建内容的 DOC',
          type: 'DOC',
          scope: 'notes',
        })
        .expect(201);

      expect(res.body.data.type).toBe('DOC');
      // 后端应自动创建了 contentItemId
      expect(res.body.data.contentItemId).toBeTruthy();
    });

    it('通过 workspace API 创建的条目自动注册到导航，导航中可以查到该 contentItemId', async () => {
      // createNoteItem 内部会同时注册 navigation 节点
      const noteId = await createNoteItem(ctx.app, cookie, '自动导航注册测试');

      // 验证该 contentItemId 已被 navigation 节点引用（通过 structure-path 接口查询）
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/contents/${noteId}/structure-path`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);
      // 路径末尾节点的 contentItemId 应等于 noteId
      const leafNode = res.body.data[res.body.data.length - 1];
      expect(leafNode.contentItemId).toBe(noteId);
    });

    it('未登录创建 → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .send({ name: '未登录创建', type: 'FOLDER', scope: 'notes' })
        .expect(401);
    });
  });

  describe('GET /api/v1/structure-nodes?scope=notes', () => {
    it('scope=notes 只返回 notes 节点', async () => {
      // 创建 notes 和 gallery 节点
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: 'notes scope 节点', type: 'FOLDER', scope: 'notes' })
        .expect(201);

      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: 'gallery scope 节点', type: 'FOLDER', scope: 'gallery' })
        .expect(201);

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/structure-nodes?scope=notes&visibility=all')
        .set('Cookie', cookie)
        .expect(200);

      const children = res.body.data.children as any[];
      const scopes = children.map((n: any) => n.scope);
      // 所有返回的节点都应属于 notes scope
      expect(scopes.every((s: string) => s === 'notes')).toBe(true);
    });

    it('scope=gallery 只返回 gallery 节点', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/structure-nodes?scope=gallery&visibility=all')
        .set('Cookie', cookie)
        .expect(200);

      const children = res.body.data.children as any[];
      const scopes = children.map((n: any) => n.scope);
      expect(scopes.every((s: string) => s === 'gallery')).toBe(true);
    });
  });

  describe('PUT /api/v1/structure-nodes/:id', () => {
    it('更新节点名称 → 返回更新后的 name', async () => {
      const createRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '更新前名称', type: 'FOLDER', scope: 'notes' })
        .expect(201);

      const id = createRes.body.data.id;

      const updateRes = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/structure-nodes/${id}`)
        .set('Cookie', cookie)
        .send({ name: '更新后名称' })
        .expect(200);

      expect(updateRes.body.data.name).toBe('更新后名称');
    });
  });

  describe('DELETE /api/v1/structure-nodes/:id', () => {
    it('删除节点后从列表消失', async () => {
      const createRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '待删除节点', type: 'FOLDER', scope: 'notes' })
        .expect(201);

      const id = createRes.body.data.id;

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${id}`)
        .set('Cookie', cookie)
        .expect(200);

      // 确认节点不再存在
      const listRes = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/structure-nodes?scope=notes&visibility=all')
        .set('Cookie', cookie)
        .expect(200);

      const ids = listRes.body.data.children.map((n: any) => n.id);
      expect(ids).not.toContain(id);
    });

    it('GET /structure-nodes/:id/delete-stats 返回删除统计', async () => {
      // 创建含子节点的文件夹
      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '统计文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);

      const folderId = folderRes.body.data.id;

      // 在文件夹下创建一个 DOC
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({
          name: '子 DOC',
          type: 'DOC',
          scope: 'notes',
          parentId: folderId,
        })
        .expect(201);

      const statsRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/structure-nodes/${folderId}/delete-stats`)
        .set('Cookie', cookie)
        .expect(200);

      expect(statsRes.body.data.folderCount).toBeGreaterThanOrEqual(1);
      expect(statsRes.body.data.docCount).toBeGreaterThanOrEqual(1);
    });
  });
});

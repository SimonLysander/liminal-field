/**
 * notes-crud.e2e-spec.ts — 笔记基本 CRUD E2E 测试
 *
 * 覆盖：创建、列表、详情、提交内容、删除。
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
} from './helpers';

describe('Notes CRUD (e2e)', () => {
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

  describe('POST /api/v1/spaces/notes/items', () => {
    it('创建笔记 → 201，返回 id 和 title', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .send({ title: 'CRUD 测试笔记' })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toMatch(/^ci_/);
      expect(res.body.data.title).toBe('CRUD 测试笔记');
    });

    it('未登录创建 → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/items')
        .send({ title: '未登录笔记' })
        .expect(401);
    });

    it('缺少 title → 400', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/v1/spaces/notes/items', () => {
    it('列表包含刚创建的笔记', async () => {
      const id = await createNoteItem(ctx.app, cookie, '列表测试笔记');

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.code).toBe(0);
      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(id);
    });

    it('管理端列表包含 latestVersion 字段', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .expect(200);

      const items: any[] = res.body.data;
      // 每个 notes 列表项应有 latestVersion
      if (items.length > 0) {
        expect(items[0]).toHaveProperty('latestVersion');
      }
    });
  });

  describe('GET /api/v1/spaces/notes/items/:id', () => {
    it('管理端详情（visibility=all）包含 latestVersion', async () => {
      const id = await createNoteItem(ctx.app, cookie, '详情测试笔记');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      expect(res.body.data.latestVersion).toBeDefined();
    });

    it('不存在的 ID → 404', async () => {
      await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items/ci_nonexistent123')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('PUT /api/v1/spaces/notes/items/:id（提交内容）', () => {
    it('提交内容后 latestVersion.commitHash 有值', async () => {
      const id = await createNoteItem(ctx.app, cookie, '提交测试笔记');

      const detail = await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 标题\n\n正文内容。',
        '提交测试笔记',
      );

      expect(detail.latestVersion.commitHash).toBeTruthy();
      expect(detail.latestVersion.commitHash).toHaveLength(40);
    });

    it('提交后 bodyMarkdown 更新', async () => {
      const id = await createNoteItem(ctx.app, cookie, '内容更新测试');
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 标题\n\n初始正文。',
        '内容更新测试',
      );

      // 第二次提交新内容
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '内容更新测试',
          summary: '内容更新测试',
          status: 'committed',
          bodyMarkdown: '# 标题\n\n更新后的正文。',
          changeNote: '更新正文',
          action: 'commit',
        })
        .expect(200);

      // bodyMarkdown 中的 ./assets/ 路径会被替换为 API URL
      expect(res.body.data.bodyMarkdown).toContain('更新后的正文');
    });

    it('提交后 headings 正确解析', async () => {
      const id = await createNoteItem(ctx.app, cookie, '标题解析测试');
      const detail = await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 一级标题\n\n正文。\n\n## 二级标题\n\n更多正文。',
        '标题解析测试',
      );

      expect(Array.isArray(detail.headings)).toBe(true);
      expect(detail.headings.length).toBeGreaterThanOrEqual(2);
      const h1 = detail.headings.find((h: any) => h.level === 1);
      expect(h1?.text).toBe('一级标题');
    });
  });

  describe('DELETE /api/v1/spaces/notes/items/:id', () => {
    it('删除存在的笔记 → 201，之后列表中消失', async () => {
      const id = await createNoteItem(ctx.app, cookie, '待删除笔记');

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .expect(200);

      // 删除后从列表中消失
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).not.toContain(id);
    });

    it('未登录删除 → 401', async () => {
      const id = await createNoteItem(ctx.app, cookie, '未登录删除测试');
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/items/${id}`)
        .expect(401);
    });
  });
});

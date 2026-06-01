/**
 * anthology-crud.e2e-spec.ts — 文集 Anthology CRUD + 发布 + scope 隔离 E2E 测试。
 *
 * Phase 1 重构(2026-05-31)后:
 * - 文集容器 + 子节点都走通用 :scope/items/:id 接口(创建/编辑/草稿/发布/删除)
 * - 子节点的创建走 POST /structure-nodes(parentId 指向容器节点)
 * - 阅读端读取:GET /spaces/anthology/public/items/:id(容器卷宗概览) /
 *   GET /spaces/anthology/public/items/:id/entries/:nodeId(单篇阅读)
 *
 * 覆盖:
 * - 创建文集容器 + 子节点
 * - 容器编辑卷首语(通用 PUT /spaces/anthology/items/:id)
 * - 子节点编辑(同上接口,nodeId 即 contentItemId)
 * - prev/next nodeId 导航
 * - 发布顺序(容器先,子节点跟)
 * - scope 隔离(anthology 容器不出现在 notes 列表)
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createAnthologyItem,
  createAnthologyChildNode,
  createNoteItem,
} from './helpers';

describe('Anthology CRUD (e2e, Phase 1 page-tree)', () => {
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

  // ─── 创建容器 ─────────────────────────────────────────────────────────

  describe('POST /api/v1/spaces/anthology/items', () => {
    it('创建文集容器 → 201,返回 id 和 title', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/anthology/items')
        .set('Cookie', cookie)
        .send({ title: 'CRUD 测试文集' })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.id).toMatch(/^ci_/);
      expect(res.body.data.title).toBe('CRUD 测试文集');
    });

    it('未登录创建 → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/anthology/items')
        .send({ title: '未登录文集' })
        .expect(401);
    });
  });

  // ─── 管理端列表 ───────────────────────────────────────────────────────

  describe('GET /api/v1/spaces/anthology/items(管理端)', () => {
    it('管理端列表包含文集,含 status 字段', async () => {
      const id = await createAnthologyItem(
        ctx.app,
        cookie,
        '管理端列表测试文集',
      );

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/anthology/items')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.code).toBe(0);
      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(id);

      const target = res.body.data.find((item: any) => item.id === id);
      expect(target).toHaveProperty('status');
      expect(target).toHaveProperty('entryCount');
    });
  });

  // ─── 子节点创建/编辑(通用页面树接口)─────────────────────────────────

  describe('文集子节点 CRUD(走通用接口)', () => {
    it('创建子节点 + 提交正文 → 容器详情包含该子节点,正文可读', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '条目测试文集');
      const nodeId = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第一篇',
        '# 第一篇\n\n这是第一篇的内容。',
      );

      // 容器管理端详情含该子节点
      const detailRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);
      expect(detailRes.body.data.entries).toHaveLength(1);
      expect(detailRes.body.data.entries[0].nodeId).toBe(nodeId);
      expect(detailRes.body.data.entries[0].title).toBe('第一篇');

      // 子节点正文走管理端阅读接口(getEntryDetail)
      const entryRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${nodeId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(entryRes.body.data.nodeId).toBe(nodeId);
      expect(entryRes.body.data.bodyMarkdown).toContain('这是第一篇的内容');
    });

    it('两个子节点的 nodeId 不同,顺序按创建顺序', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '多条目文集');
      const k1 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第一篇',
        '第一篇正文。',
      );
      const k2 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第二篇',
        '第二篇正文。',
      );

      expect(k1).not.toBe(k2);
      const detailRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);
      const keys = detailRes.body.data.entries.map((e: any) => e.nodeId);
      expect(keys).toEqual([k1, k2]);
    });

    it('编辑子节点正文(通用 PUT /spaces/anthology/items/:nodeId)→ 正文更新', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '编辑正文测试文集');
      const nodeId = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '初始标题',
        '初始正文。',
      );

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${nodeId}`)
        .set('Cookie', cookie)
        .send({
          title: '初始标题',
          bodyMarkdown: '更新后的正文内容。',
          changeNote: '更新正文',
        })
        .expect(200);

      const entryRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${nodeId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(entryRes.body.data.bodyMarkdown).toContain('更新后的正文内容');
    });
  });

  // ─── prev/next 导航(nodeId 命名)────────────────────────────────────

  describe('GET /spaces/anthology/public/items/:id/entries/:nodeId', () => {
    it('第一篇:prev=null,next.nodeId=第二篇', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '条目详情测试文集');
      const k1 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第一篇',
        '第一篇正文。',
      );
      const k2 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第二篇',
        '第二篇正文。',
      );

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${k1}`)
        .set('Cookie', cookie)
        .expect(200);

      const entry = res.body.data;
      expect(entry.nodeId).toBe(k1);
      expect(entry.prev).toBeNull();
      expect(entry.next).toMatchObject({ nodeId: k2, title: '第二篇' });
    });

    it('最后一篇:prev.nodeId=前一篇,next=null', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '末篇导航测试文集');
      const k1 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第一篇',
        '第一篇。',
      );
      const k2 = await createAnthologyChildNode(
        ctx.app,
        cookie,
        id,
        '第二篇',
        '第二篇。',
      );

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${k2}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.prev).toMatchObject({ nodeId: k1 });
      expect(res.body.data.next).toBeNull();
    });
  });

  // ─── 容器卷首语(Phase 1 新增) ───────────────────────────────────────

  describe('容器卷首语 bodyMarkdown', () => {
    it('容器 PUT 含 bodyMarkdown → 管理端详情读到卷首语', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '卷首语测试文集');
      const PREFACE = '## 卷首\n\n这是一段卷首语。';

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '卷首语测试文集',
          bodyMarkdown: PREFACE,
          changeNote: '写卷首语',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.data.bodyMarkdown).toContain('这是一段卷首语');
    });

    it('PATCH meta 更新简介 → 管理端详情读到新简介且保留卷首语', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '简介 inline edit 文集');
      const PREFACE = '## 卷首\n\n这段卷首语不能丢。';

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '简介 inline edit 文集',
          bodyMarkdown: PREFACE,
          changeNote: '写卷首语',
        })
        .expect(200);

      const patchRes = await supertest(ctx.app.getHttpServer())
        .patch(`/api/v1/spaces/anthology/items/${id}/meta`)
        .set('Cookie', cookie)
        .send({ summary: '新的文集简介' })
        .expect(200);

      expect(patchRes.body.data.description).toBe('新的文集简介');
      expect(patchRes.body.data.bodyMarkdown).toContain('这段卷首语不能丢');

      const detailRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);
      expect(detailRes.body.data.description).toBe('新的文集简介');
      expect(detailRes.body.data.bodyMarkdown).toContain('这段卷首语不能丢');
    });
  });

  // ─── scope 隔离 ─────────────────────────────────────────────────────

  describe('Scope 隔离', () => {
    it('anthology 容器不出现在 notes 列表里', async () => {
      const anthologyId = await createAnthologyItem(
        ctx.app,
        cookie,
        'scope 隔离文集',
      );
      const noteId = await createNoteItem(ctx.app, cookie, 'scope 隔离笔记');

      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(noteId);
      expect(ids).not.toContain(anthologyId);
    });

    it('anthology 容器通过 /notes/items/:id 访问 → 404', async () => {
      const anthologyId = await createAnthologyItem(
        ctx.app,
        cookie,
        'scope 隔离跨访问文集',
      );

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${anthologyId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });
});

// ─── 发布测试(独立 TestContext,保证状态干净)────────────────────────────

describe('Anthology 发布 (e2e, Phase 1 page-tree)', () => {
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

  it('发布文集 → publishedVersion 不为 null,status=published', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '发布测试文集');
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      id,
      '第一篇',
      '这是发布测试的第一篇。',
    );

    // 容器先发布
    const res = await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 子节点跟着发布(走通用 :scope/items/:id/publish)
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    expect(res.body.data.status).toBe('published');
  });

  it('空文集发布 → 200(文集先发:容器可先上线,读者暂见空集)', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '空文集发布测试');
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
  });

  it('展示端未登录可以拿到已发布文集列表(不含 status 管理字段)', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '展示端列表测试文集');
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      id,
      '公开条目',
      '公开的内容。',
    );

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    const res = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/spaces/anthology/items')
      .expect(200);

    expect(res.body.code).toBe(0);
    const ids = res.body.data.map((item: any) => item.id);
    expect(ids).toContain(id);

    const target = res.body.data.find((item: any) => item.id === id);
    expect(target).not.toHaveProperty('status');
    expect(target).toHaveProperty('entryCount');
  });

  it('展示端可读取已发布条目详情(走 /public/ 路由)', async () => {
    const id = await createAnthologyItem(
      ctx.app,
      cookie,
      '展示端条目详情测试文集',
    );
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      id,
      '公开条目',
      '公开的条目内容。',
    );

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 无 cookie(展示端)
    const res = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${nodeId}`)
      .expect(200);

    expect(res.body.data.nodeId).toBe(nodeId);
    expect(res.body.data.title).toBe('公开条目');
    expect(res.body.data.bodyMarkdown).toContain('公开的条目内容');
  });

  it('发布后编辑条目 → 展示端读已发布冻结 snapshot(不受新编辑影响)', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '发布后编辑测试文集');
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      id,
      '原始标题',
      '原始正文。',
    );

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 编辑条目(走通用 PUT)
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}`)
      .set('Cookie', cookie)
      .send({
        title: '修改后的标题',
        bodyMarkdown: '修改后的正文。',
        changeNote: '发布后修改',
      })
      .expect(200);

    // 管理端容器详情:子节点 title 已同步
    const adminRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);
    const adminEntry = adminRes.body.data.entries.find(
      (e: any) => e.nodeId === nodeId,
    );
    expect(adminEntry.title).toBe('修改后的标题');

    // 展示端读已发布冻结版本(原始正文)
    const publicRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/public/items/${id}/entries/${nodeId}`)
      .expect(200);
    expect(publicRes.body.data.nodeId).toBe(nodeId);
    expect(publicRes.body.data.bodyMarkdown).toContain('原始正文');
  });

  it('取消发布 → 展示端列表不含该文集', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '取消发布测试文集');
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      id,
      '唯一条目',
      '取消发布测试内容。',
    );

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    const unpublishRes = await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/unpublish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    expect(unpublishRes.body.data.status).toBe('committed');

    const publicList = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/spaces/anthology/items')
      .expect(200);

    const ids = publicList.body.data.map((item: any) => item.id);
    expect(ids).not.toContain(id);
  });
});

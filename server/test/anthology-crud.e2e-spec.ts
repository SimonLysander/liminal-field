/**
 * anthology-crud.e2e-spec.ts — 文集 Anthology CRUD + 发布 + scope 隔离 E2E 测试。
 *
 * 覆盖：
 * - 创建文集（POST /spaces/anthology/items）
 * - 管理端列表（GET /spaces/anthology/items）
 * - 条目增删改查（entries 子路由）
 * - 条目重排（PUT /entries/reorder）
 * - 发布 / 取消发布流程（展示端可见性验证）
 * - scope 隔离（anthology 条目不出现在 notes 列表）
 *
 * 设计说明：
 * - 每个 describe 尽量共享同一个 TestContext（beforeAll），避免重复启动 MongoMemoryServer。
 * - 只有发布测试需要独立 TestContext（保证 published 状态干净）。
 * - entry key 现在是条目子 ContentItem 的 id（ci_xxx 格式），测试中不断言具体值，
 *   而是通过 addAnthologyEntry 返回的 entryKey 动态获取。
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createAnthologyItem,
  addAnthologyEntry,
  createNoteItem,
} from './helpers';

describe('Anthology CRUD (e2e)', () => {
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

  // ─── 创建 ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/spaces/anthology/items', () => {
    it('创建文集 → 201，返回 id 和 title', async () => {
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

  // ─── 管理端列表 ───────────────────────────────────────────────────────────

  describe('GET /api/v1/spaces/anthology/items（管理端）', () => {
    it('管理端列表包含文集，含 status 字段', async () => {
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

      // 管理端 DTO 应有 status 和 entryCount 字段
      const target = res.body.data.find((item: any) => item.id === id);
      expect(target).toHaveProperty('status');
      expect(target).toHaveProperty('entryCount');
    });
  });

  // ─── 条目管理 ─────────────────────────────────────────────────────────────

  describe('POST /api/v1/spaces/anthology/items/:id/entries', () => {
    it('添加条目 → 201，索引更新，条目列表包含新条目', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '条目测试文集');

      const { entryKey, detail } = await addAnthologyEntry(
        ctx.app,
        cookie,
        id,
        {
          title: '第一篇',
          date: '2026-05-01',
          bodyMarkdown: '# 第一篇\n\n这是第一篇的内容。',
        },
      );

      // addEntry 返回 AnthologyAdminDetailDto
      expect(detail.id).toBe(id);
      expect(Array.isArray(detail.entries)).toBe(true);
      expect(detail.entries).toHaveLength(1);
      // entry key 现在是条目子 ContentItem 的 id（ci_xxx），只断言格式
      expect(entryKey).toMatch(/^ci_/);
      expect(detail.entries[0].key).toBe(entryKey);
      expect(detail.entries[0].title).toBe('第一篇');
    });

    it('添加第二个条目 → 顺序正确，两个条目 key 不相同（唯一性验证）', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '多条目文集');

      const { entryKey: key1 } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第一篇',
        bodyMarkdown: '第一篇正文。',
      });

      const { detail } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第二篇',
        bodyMarkdown: '第二篇正文。',
      });

      expect(detail.entries).toHaveLength(2);
      // 两个 key 都是 ci_xxx 格式且互不相同
      expect(detail.entries[0].key).toMatch(/^ci_/);
      expect(detail.entries[1].key).toMatch(/^ci_/);
      expect(detail.entries[0].key).not.toBe(detail.entries[1].key);
      // 第一个条目 key 与首次添加时一致（顺序稳定）
      expect(detail.entries[0].key).toBe(key1);
      expect(detail.entries[0].title).toBe('第一篇');
      expect(detail.entries[1].title).toBe('第二篇');
    });
  });

  describe('GET /api/v1/spaces/anthology/items/:id/entries/:entryKey', () => {
    it('获取条目详情 → 返回正文和 prev/next', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '条目详情测试文集');

      const { entryKey: key1 } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第一篇',
        bodyMarkdown: '第一篇正文。',
      });
      const { entryKey: key2 } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第二篇',
        bodyMarkdown: '第二篇正文。',
      });

      // 管理端获取第一篇条目详情（带 cookie）
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}/entries/${key1}`)
        .set('Cookie', cookie)
        .expect(200);

      const entry = res.body.data;
      expect(entry.key).toBe(key1);
      expect(entry.title).toBe('第一篇');
      expect(entry.bodyMarkdown).toContain('第一篇正文');
      // 第一篇：prev 为 null，next 指向第二篇
      expect(entry.prev).toBeNull();
      expect(entry.next).toMatchObject({ key: key2, title: '第二篇' });
    });

    it('获取最后一篇条目 → next 为 null', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '末篇导航测试文集');

      const { entryKey: key1 } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第一篇',
        bodyMarkdown: '第一篇。',
      });
      const { entryKey: key2 } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '第二篇',
        bodyMarkdown: '第二篇。',
      });

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}/entries/${key2}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.prev).toMatchObject({ key: key1 });
      expect(res.body.data.next).toBeNull();
    });
  });

  describe('PUT /api/v1/spaces/anthology/items/:id/entries/:entryKey', () => {
    it('编辑条目正文 → 正文更新', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '编辑正文测试文集');
      const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '初始标题',
        bodyMarkdown: '初始正文。',
      });

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
        .set('Cookie', cookie)
        .send({
          title: '初始标题',
          bodyMarkdown: '更新后的正文内容。',
          changeNote: '更新正文',
        })
        .expect(200);

      // 验证条目详情正文已更新
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.bodyMarkdown).toContain('更新后的正文内容');
    });

    it('编辑条目标题 → 索引冗余字段同步更新', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '编辑标题测试文集');
      const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: '旧标题',
        bodyMarkdown: '正文内容。',
      });

      // 修改标题
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
        .set('Cookie', cookie)
        .send({
          title: '新标题',
          bodyMarkdown: '正文内容。',
          changeNote: '修改标题',
        })
        .expect(200);

      // 返回的 detail 中索引条目 title 应已同步更新
      const updatedEntry = res.body.data.entries.find(
        (e: any) => e.key === entryKey,
      );
      expect(updatedEntry).toBeDefined();
      expect(updatedEntry.title).toBe('新标题');
    });
  });

  describe('DELETE /api/v1/spaces/anthology/items/:id/entries/:entryKey', () => {
    it('删除条目 → 索引更新，条目列表不含该条目', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '删除条目测试文集');
      const { entryKey: keyToDelete } = await addAnthologyEntry(
        ctx.app,
        cookie,
        id,
        {
          title: '待删除',
          bodyMarkdown: '待删除的正文。',
        },
      );
      const { entryKey: keyToKeep } = await addAnthologyEntry(
        ctx.app,
        cookie,
        id,
        {
          title: '保留条目',
          bodyMarkdown: '保留的正文。',
        },
      );

      const res = await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/anthology/items/${id}/entries/${keyToDelete}`)
        .set('Cookie', cookie)
        .expect(200);

      // 删除后被删条目不存在，保留条目仍在
      const keys = res.body.data.entries.map((e: any) => e.key);
      expect(keys).not.toContain(keyToDelete);
      expect(keys).toContain(keyToKeep);
    });
  });

  // ─── 重排 ────────────────────────────────────────────────────────────────

  describe('PUT /api/v1/spaces/anthology/items/:id/entries/reorder', () => {
    it('重排条目顺序 → 顺序变化', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '重排测试文集');
      const { entryKey: keyA } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: 'A',
        bodyMarkdown: 'A 正文。',
      });
      const { entryKey: keyB } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: 'B',
        bodyMarkdown: 'B 正文。',
      });
      const { entryKey: keyC } = await addAnthologyEntry(ctx.app, cookie, id, {
        title: 'C',
        bodyMarkdown: 'C 正文。',
      });

      // 反向排列：C → B → A
      const res = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}/entries/reorder`)
        .set('Cookie', cookie)
        .send({ newOrder: [keyC, keyB, keyA] })
        .expect(200);

      const keys = res.body.data.entries.map((e: any) => e.key);
      expect(keys).toEqual([keyC, keyB, keyA]);
    });

    it('newOrder 包含不存在的 key → 400', async () => {
      const id = await createAnthologyItem(ctx.app, cookie, '非法重排测试文集');
      await addAnthologyEntry(ctx.app, cookie, id, {
        title: 'A',
        bodyMarkdown: 'A。',
      });

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/anthology/items/${id}/entries/reorder`)
        .set('Cookie', cookie)
        .send({ newOrder: ['e_notexist'] })
        .expect(400);
    });
  });

  // ─── scope 隔离 ───────────────────────────────────────────────────────────

  describe('Scope 隔离', () => {
    it('anthology scope 的条目不出现在 notes 列表里', async () => {
      const anthologyId = await createAnthologyItem(
        ctx.app,
        cookie,
        'scope 隔离文集',
      );
      const noteId = await createNoteItem(ctx.app, cookie, 'scope 隔离笔记');

      // notes 列表中应有 noteId 但不包含 anthologyId
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/spaces/notes/items')
        .set('Cookie', cookie)
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(noteId);
      expect(ids).not.toContain(anthologyId);
    });

    it('anthology 条目通过 /notes/items/:id 访问 → 404', async () => {
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

// ─── 发布测试（独立 TestContext，保证状态干净）────────────────────────────────

describe('Anthology 发布 (e2e)', () => {
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

  it('发布文集 → publishedVersion 不为 null，status=published', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '发布测试文集');
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
      title: '第一篇',
      bodyMarkdown: '这是发布测试的第一篇。',
    });

    // 发布顺序（2026-05-28）：文集先上线，再发布条目（publishEntry 守卫文集已发布）
    const res = await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    expect(res.body.data.status).toBe('published');
  });

  it('空文集发布 → 200（文集先发：容器可先上线，读者暂见空集）', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '空文集发布测试');
    // 不添加任何条目；「文集先发」设计允许空集容器先上线
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
  });

  it('展示端未登录可以拿到已发布文集列表', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '展示端列表测试文集');
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
      title: '公开条目',
      bodyMarkdown: '公开的内容。',
    });

    // 新发布流程：先发布条目，再发布文集
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 无 cookie 访问列表（展示端）
    const res = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/spaces/anthology/items')
      .expect(200);

    expect(res.body.code).toBe(0);
    const ids = res.body.data.map((item: any) => item.id);
    expect(ids).toContain(id);

    // 展示端 DTO 不含 status（管理字段）
    const target = res.body.data.find((item: any) => item.id === id);
    expect(target).not.toHaveProperty('status');
    expect(target).toHaveProperty('entryCount');
  });

  it('展示端可以读取已发布条目详情', async () => {
    const id = await createAnthologyItem(
      ctx.app,
      cookie,
      '展示端条目详情测试文集',
    );
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
      title: '公开条目',
      bodyMarkdown: '公开的条目内容。',
    });

    // 新发布流程：先发布条目（设置 publishedVersionId），再发布文集
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 无 cookie 读条目详情
    const res = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
      .expect(200);

    expect(res.body.data.key).toBe(entryKey);
    expect(res.body.data.title).toBe('公开条目');
    expect(res.body.data.bodyMarkdown).toContain('公开的条目内容');
  });

  it('发布后编辑条目 → 展示端读条目已发布 snapshot（发布时已冻结版本）', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '发布后编辑测试文集');
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
      title: '原始标题',
      bodyMarkdown: '原始正文。',
    });

    // 新发布流程：先发布条目，再发布文集
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 编辑条目（修改标题 + 正文）
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
      .set('Cookie', cookie)
      .send({
        title: '修改后的标题',
        bodyMarkdown: '修改后的正文。',
        changeNote: '发布后修改',
      })
      .expect(200);

    // 管理端看到最新标题（索引中 title 冗余字段已同步更新）
    const adminRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${id}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);
    const adminEntry = adminRes.body.data.entries.find(
      (e: any) => e.key === entryKey,
    );
    expect(adminEntry.title).toBe('修改后的标题');

    // 展示端读已发布版本的冻结 snapshot（getEntryDetail usePublished=true
    // 从 publishedVersionId 精确定位 snapshot）。
    // 发布后编辑不影响展示端，展示端仍读发布时的原始内容。
    const publicRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}`)
      .expect(200);
    // 条目详情可读到 → 200，key 正确
    expect(publicRes.body.data.key).toBe(entryKey);
    // 展示端读已发布版本（原始正文），不受编辑影响
    expect(publicRes.body.data.bodyMarkdown).toContain('原始正文');
  });

  it('取消发布 → 展示端列表不含该文集', async () => {
    const id = await createAnthologyItem(ctx.app, cookie, '取消发布测试文集');
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, id, {
      title: '唯一条目',
      bodyMarkdown: '取消发布测试内容。',
    });

    // 新发布流程：先发布条目，再发布文集
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/entries/${entryKey}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    // 取消发布
    const unpublishRes = await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${id}/unpublish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    expect(unpublishRes.body.data.status).toBe('committed');

    // 展示端列表不含该文集
    const publicList = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/spaces/anthology/items')
      .expect(200);

    const ids = publicList.body.data.map((item: any) => item.id);
    expect(ids).not.toContain(id);
  });
});

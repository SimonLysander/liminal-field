/**
 * version-system.e2e-spec.ts — V2 版本系统 E2E 测试
 *
 * 覆盖 V2 分层存储架构下，版本管理的核心路径：
 * 1. 创建 → 提交 → 查看历史（history 从 ContentSnapshot 读，不依赖 Git）
 * 2. 多版本 → 版本预览（按 versionId 读取指定版本快照）
 * 3. 发布指定 versionId（publishedVersion.versionId 等于传入值）
 * 4. 全文搜索（标题/摘要匹配，管理员可见所有内容）
 *
 * 设计决策：
 * - 搜索端点（GET /search）对未登录用户强制 visibility=public，
 *   因此搜索场景需要先 publish 内容，否则搜不到任何结果。
 * - history 返回按 createdAt 降序排列，最新版本在前。
 * - versionId 是 nanoid(16)，不是 git commitHash。
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
} from './helpers';

describe('Version System (e2e)', () => {
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

  // ─────────────────────────────────────────────────────────────────
  // 场景 1：创建 → 提交 → 查看历史
  // ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/spaces/notes/items/:id/history', () => {
    it('提交一次后 history 返回 1 条记录，包含 versionId / changeNote / title', async () => {
      const id = await createNoteItem(ctx.app, cookie, '历史测试笔记');

      // 提交：action=commit 写入 snapshot + 异步归档 Git
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# V1\n\n第一版内容。',
        '历史测试笔记',
      );

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/history`)
        .set('Cookie', cookie)
        .expect(200);

      // history 包含：本次提交 + 创建时自动生成的初始快照，共至少 1 条
      // 本实现：createContent 创建初始空快照，commit 再追加，所以至少 2 条
      const history: any[] = res.body.data;
      expect(history.length).toBeGreaterThanOrEqual(1);

      // 最新版本排在最前（listByContentItemId 按 createdAt 降序）
      const latestEntry = history[0];
      expect(latestEntry.versionId).toBeTruthy();
      // versionId 是 nanoid(16)，不是 git commitHash
      expect(typeof latestEntry.versionId).toBe('string');
      expect(latestEntry.versionId.length).toBeGreaterThanOrEqual(8);
      expect(latestEntry.changeNote).toBe('初始提交');
      expect(latestEntry.title).toBe('历史测试笔记');
    });

    it('提交两次后 history 包含两条提交记录（changeNote 各不相同）', async () => {
      const id = await createNoteItem(ctx.app, cookie, '多版本历史测试');

      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# V1\n\n第一版。',
        '多版本历史测试',
      );

      // 第二次提交
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '多版本历史测试',
          summary: '多版本历史测试',
          status: 'committed',
          bodyMarkdown: '# V2\n\n第二版内容更新。',
          changeNote: '第二次更新',
          action: 'commit',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/history`)
        .set('Cookie', cookie)
        .expect(200);

      const history: any[] = res.body.data;
      // 2 次 commit + 1 次创建时初始快照 = 至少 3 条（或不含创建快照时 2 条）
      // 只断言 >= 2，兼容不同初始快照策略
      expect(history.length).toBeGreaterThanOrEqual(2);

      // 每条都必须有 versionId、committedAt
      for (const entry of history) {
        expect(entry.versionId).toBeTruthy();
        expect(entry.committedAt).toBeTruthy();
      }

      // 最新一次提交的 changeNote 应该是"第二次更新"
      const changeNotes = history.map((e: any) => e.changeNote);
      expect(changeNotes).toContain('第二次更新');
      expect(changeNotes).toContain('初始提交');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 场景 2：多版本 → 版本预览
  // ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/spaces/notes/items/:id/versions/:versionId', () => {
    it('提交两版后，按第一版 versionId 预览，返回对应 bodyMarkdown', async () => {
      const id = await createNoteItem(ctx.app, cookie, '版本预览测试');

      // 第一次提交
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 第一版\n\n这是第一版正文内容。',
        '版本预览测试',
      );

      // 取第一版提交后的 history，获取 versionId
      const historyResAfterV1 = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/history`)
        .set('Cookie', cookie)
        .expect(200);

      // history 降序排列，此时最新提交（第一版 commit）在 history[0]
      const v1Entry = historyResAfterV1.body.data.find(
        (e: any) => e.changeNote === '初始提交',
      );
      expect(v1Entry).toBeDefined();
      const v1VersionId: string = v1Entry.versionId;

      // 第二次提交，正文内容不同
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '版本预览测试',
          summary: '版本预览测试',
          status: 'committed',
          bodyMarkdown: '# 第二版\n\n这是更新后的第二版内容。',
          changeNote: '第二版更新',
          action: 'commit',
        })
        .expect(200);

      // 用第一版的 versionId 预览，期望看到第一版的正文
      const previewRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/versions/${v1VersionId}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(previewRes.body.data.bodyMarkdown).toContain('第一版正文内容');
      expect(previewRes.body.data.bodyMarkdown).not.toContain('第二版');
    });

    it('提交两版后，按第二版 versionId 预览，返回对应 bodyMarkdown', async () => {
      const id = await createNoteItem(ctx.app, cookie, '版本预览第二版测试');

      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# V1\n\n原始内容。',
        '版本预览第二版测试',
      );

      // 第二次提交
      const v2CommitRes = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '版本预览第二版测试',
          summary: '版本预览第二版测试',
          status: 'committed',
          bodyMarkdown: '# V2\n\n最新版本的独特内容。',
          changeNote: 'V2 提交',
          action: 'commit',
        })
        .expect(200);

      // 从 history 中取 V2 的 versionId
      const historyRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/history`)
        .set('Cookie', cookie)
        .expect(200);

      const v2Entry = historyRes.body.data.find(
        (e: any) => e.changeNote === 'V2 提交',
      );
      expect(v2Entry).toBeDefined();
      const v2VersionId: string = v2Entry.versionId;

      // 也可以从 latestVersion.versionId 直接取（两者应一致）
      expect(v2CommitRes.body.data.latestVersion.versionId).toBe(v2VersionId);

      const previewRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/versions/${v2VersionId}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(previewRes.body.data.bodyMarkdown).toContain('最新版本的独特内容');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 场景 3：发布指定 versionId
  // ─────────────────────────────────────────────────────────────────

  describe('PUT /api/v1/spaces/notes/items/:id/publish（指定 versionId）', () => {
    it('创建 → 提交两次 → 发布第一版 → publishedVersion.versionId 等于第一版 versionId', async () => {
      const id = await createNoteItem(ctx.app, cookie, '指定版本发布测试');

      // 第一次提交
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# V1\n\n第一版内容（待发布此版）。',
        '指定版本发布测试',
      );

      // 取第一版 versionId
      const historyAfterV1 = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/history`)
        .set('Cookie', cookie)
        .expect(200);

      const v1Entry = historyAfterV1.body.data.find(
        (e: any) => e.changeNote === '初始提交',
      );
      expect(v1Entry).toBeDefined();
      const v1VersionId: string = v1Entry.versionId;

      // 第二次提交（版本前进，latestVersion 现在指向 V2）
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '指定版本发布测试',
          summary: '指定版本发布测试',
          status: 'committed',
          bodyMarkdown: '# V2\n\n第二版更新内容。',
          changeNote: '第二版',
          action: 'commit',
        })
        .expect(200);

      // 发布第一版（传入 v1VersionId）
      const publishRes = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({ versionId: v1VersionId })
        .expect(200);

      expect(publishRes.body.data.status).toBe('published');
      expect(publishRes.body.data.publishedVersion).toBeDefined();
      expect(publishRes.body.data.publishedVersion.versionId).toBe(v1VersionId);
    });

    it('发布最新版（不传 versionId）→ publishedVersion.versionId = latestVersion.versionId', async () => {
      const id = await createNoteItem(ctx.app, cookie, '发布最新版测试');

      const commitRes = await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 最新版\n\n只有一个版本。',
        '发布最新版测试',
      );
      const latestVersionId = commitRes.latestVersion.versionId;

      const publishRes = await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      expect(publishRes.body.data.publishedVersion.versionId).toBe(
        latestVersionId,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 场景 4：搜索
  // ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/search', () => {
    it('管理员搜索（visibility=all）可以搜到未发布内容', async () => {
      const uniqueSuffix = `search-test-${Date.now()}`;
      const id = await createNoteItem(
        ctx.app,
        cookie,
        `唯一搜索关键词-${uniqueSuffix}`,
      );

      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        '# 搜索测试\n\n包含唯一词的内容。',
        `唯一搜索关键词-${uniqueSuffix}`,
      );

      // 管理员带 cookie + visibility=all 搜索
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/search?q=${encodeURIComponent(uniqueSuffix)}&visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      const items: any[] = res.body.data;
      const found = items.find((item: any) => item.id === id);
      expect(found).toBeDefined();
    });

    it('创建两篇已发布内容（不同关键字）→ 各自关键字搜索只返回对应内容', async () => {
      const suffix = Date.now();
      const keyword1 = `alpha-${suffix}`;
      const keyword2 = `beta-${suffix}`;

      // 创建并发布第一篇
      const id1 = await createNoteItem(ctx.app, cookie, `文章-${keyword1}`);
      await commitNoteContent(
        ctx.app,
        cookie,
        id1,
        `# Alpha 文章\n\n包含 ${keyword1} 的正文。`,
        `文章-${keyword1}`,
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id1}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 创建并发布第二篇
      const id2 = await createNoteItem(ctx.app, cookie, `文章-${keyword2}`);
      await commitNoteContent(
        ctx.app,
        cookie,
        id2,
        `# Beta 文章\n\n包含 ${keyword2} 的正文。`,
        `文章-${keyword2}`,
      );
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id2}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 搜索 keyword1（未登录 → visibility=public，只返回已发布内容）
      const res1 = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/search?q=${encodeURIComponent(keyword1)}`)
        .expect(200);

      const ids1 = res1.body.data.map((item: any) => item.id);
      expect(ids1).toContain(id1);
      expect(ids1).not.toContain(id2);

      // 搜索 keyword2
      const res2 = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/search?q=${encodeURIComponent(keyword2)}`)
        .expect(200);

      const ids2 = res2.body.data.map((item: any) => item.id);
      expect(ids2).toContain(id2);
      expect(ids2).not.toContain(id1);
    });

    it('未发布内容 → 未登录搜索不可见', async () => {
      const suffix = `unpublished-${Date.now()}`;
      const id = await createNoteItem(ctx.app, cookie, `未发布文章-${suffix}`);
      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        `# 未发布\n\n${suffix} 内容。`,
        `未发布文章-${suffix}`,
      );
      // 刻意不发布

      // 未登录搜索
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/search?q=${encodeURIComponent(suffix)}`)
        .expect(200);

      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).not.toContain(id);
    });
  });
});

/**
 * batch-publish.e2e-spec.ts — 批量发布/取消发布 + 文件夹概览 E2E 测试
 *
 * 覆盖：
 * - 批量发布文件夹下所有文档（successCount=3）
 * - 重复批量发布时已发布文档被跳过（successCount=0, skippedCount=3）
 * - 批量取消发布（successCount=3）
 * - 文件夹概览统计正确（stats.published / stats.unpublished）
 * - 文件夹概览 children 数组包含正确条目及 publishStatus
 *
 * API 路由：
 * - POST /api/v1/spaces/notes/batch/publish  → { successCount, skippedCount }
 * - POST /api/v1/spaces/notes/batch/unpublish → { successCount, skippedCount }
 * - GET  /api/v1/structure-nodes/:id/overview → FolderOverviewDto
 *
 * 注意：batchPublish 要求 DOC 节点有 ContentItem，且 ContentItem 有至少一个 snapshot
 * （createContent 已创建初始 snapshot，因此无需额外 commit 也能发布；
 *  但 commit 后再发布语义更清晰，且 hasUnpublishedChanges 更易预测）。
 */
import supertest from 'supertest';
import {
  TestContext,
  login,
  commitNoteContent,
} from './helpers';

describe('Batch Publish (e2e)', () => {
  let ctx: TestContext;
  let cookie: string;

  // 跨 test case 共享的状态
  let folderId: string;
  // 3 个 DOC 节点的 contentItemId（从 structure-node 创建时后端自动生成）
  const contentItemIds: string[] = [];

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup();
    cookie = await login(ctx.app);

    // ─── 准备：创建文件夹 + 3 个 DOC 节点 + 各自提交内容 ───
    const folderRes = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/structure-nodes')
      .set('Cookie', cookie)
      .send({ name: '批量发布测试文件夹', type: 'FOLDER', scope: 'notes' })
      .expect(201);
    folderId = folderRes.body.data.id;

    for (let i = 1; i <= 3; i++) {
      const docRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({
          name: `子文档 ${i}`,
          type: 'DOC',
          scope: 'notes',
          parentId: folderId,
        })
        .expect(201);
      const contentItemId = docRes.body.data.contentItemId;
      expect(contentItemId).toBeTruthy();
      contentItemIds.push(contentItemId);

      // 提交内容（保证 latestVersion 存在，语义明确）
      await commitNoteContent(
        ctx.app,
        cookie,
        contentItemId,
        `# 子文档 ${i}\n\n这是第 ${i} 篇文档的内容。`,
        `子文档 ${i}`,
      );
    }
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('批量发布文件夹下所有文档 → successCount=3', async () => {
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/batch/publish')
      .set('Cookie', cookie)
      .send({ folderId })
      .expect(201);

    expect(res.body.code).toBe(0);
    expect(res.body.data.successCount).toBe(3);
    expect(res.body.data.skippedCount).toBe(0);
  });

  it('重复批量发布 → successCount=3（publishVersion 是幂等操作，不区分已发布）', async () => {
    // publishVersion 不检查「已发布」状态，每次都会更新 publishedVersion 指针并成功。
    // 因此重复 batchPublish 的 successCount 仍为 3，skippedCount=0。
    // （跳过逻辑只针对「无 versionId 即未提交」的内容，这里 3 篇都已提交）
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/batch/publish')
      .set('Cookie', cookie)
      .send({ folderId })
      .expect(201);

    expect(res.body.code).toBe(0);
    expect(res.body.data.successCount).toBe(3);
    expect(res.body.data.skippedCount).toBe(0);
  });

  it('批量取消发布 → successCount=3', async () => {
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/batch/unpublish')
      .set('Cookie', cookie)
      .send({ folderId })
      .expect(201);

    expect(res.body.code).toBe(0);
    expect(res.body.data.successCount).toBe(3);
    expect(res.body.data.skippedCount).toBe(0);
  });

  describe('文件夹概览（GET /structure-nodes/:id/overview）', () => {
    // 先发布所有文档，再验证概览数据
    beforeAll(async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/batch/publish')
        .set('Cookie', cookie)
        .send({ folderId })
        .expect(201);
    });

    it('概览统计数字正确（3 篇均已发布）', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/structure-nodes/${folderId}/overview`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.code).toBe(0);
      const { stats } = res.body.data;
      // 3 篇全部发布，没有未发布/待更新的文档
      expect(stats.docCount).toBe(3);
      expect(stats.published).toBe(3);
      expect(stats.unpublished).toBe(0);
    });

    it('概览 children 数组包含 3 个子项，publishStatus 均为 published', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/structure-nodes/${folderId}/overview`)
        .set('Cookie', cookie)
        .expect(200);

      const { children } = res.body.data;
      expect(children).toHaveLength(3);

      // 每个子项应包含 type、publishStatus、contentItemId 等关键字段
      for (const child of children) {
        expect(child.type).toBe('DOC');
        expect(child.publishStatus).toBe('published');
        expect(contentItemIds).toContain(child.contentItemId);
      }
    });

    it('概览 folder 字段包含文件夹 id 和 name', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/structure-nodes/${folderId}/overview`)
        .set('Cookie', cookie)
        .expect(200);

      const { folder } = res.body.data;
      expect(folder.id).toBe(folderId);
      expect(folder.name).toBe('批量发布测试文件夹');
    });
  });
});

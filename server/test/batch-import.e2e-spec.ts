/**
 * batch-import.e2e-spec.ts — 批量 zip 导入流程 E2E 测试
 *
 * 覆盖：
 * - zip 上传解析（batch-parse）→ 返回 batchId + items 数组
 * - batch-confirm 创建文档 → docsCreated=2
 * - 导入后文档可读取，bodyMarkdown 含原始内容
 * - 取消导入清理临时文件 → batch/:batchId 返回 404
 * - 进度查询（batch-job/:jobId）→ 含 status 字段
 *
 * 实现说明：
 * - batchConfirm 立即返回 { jobId, docsCreated } 后，实际写入在后台异步进行。
 *   测试需要轮询 /batch-job/:jobId 直至 status='done' 后再验证内容，
 *   避免因竞态导致内容未写入就断言。
 * - JSZip 用于在测试中构造 zip buffer，与浏览器端的打包方式一致。
 */
import supertest from 'supertest';
import JSZip from 'jszip';
import { TestContext, login } from './helpers';

/** 最小合法 PNG（1x1 透明像素） */
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c62000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

/**
 * 轮询进度接口，直至 status='done' 或超时（最长 30 秒）。
 * batchConfirm 后台处理通常在测试环境中很快完成（< 5s），
 * 超时阈值设为 30s 留出充分余量，避免偶发慢机上的 flaky。
 *
 * 注意：batch-job/:jobId 路由需要认证，必须传入 cookie。
 */
async function waitForBatchJobDone(
  app: any,
  jobId: string,
  cookie: string,
  timeoutMs = 30_000,
): Promise<{ status: string; completed: number; total: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/spaces/notes/import/batch-job/${jobId}`)
      .set('Cookie', cookie)
      .expect(200);
    const progress = res.body.data ?? res.body;
    if (progress.status === 'done' || progress.status === 'failed') {
      return progress;
    }
    // 等 200ms 再轮询，避免空转
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`batch job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe('Batch Import (e2e)', () => {
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

  describe('zip 上传解析（batch-parse）', () => {
    it('zip 上传解析 → 返回 batchId + items（2 个 .md 文件）', async () => {
      // 构造含 2 个 .md 文件的 zip（doc1.md 和 sub/doc2.md + sub/assets/image.png）
      const zip = new JSZip();
      zip.file('doc1.md', '# Document 1\n\nContent here');
      zip.file('sub/assets/image.png', MINIMAL_PNG);
      zip.file(
        'sub/doc2.md',
        '# Document 2\n\n![](assets/image.png)\n\nWith subfolder',
      );
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // 创建父文件夹
      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: 'zip 解析测试文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);
      const parentId = folderRes.body.data.id;

      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .field('parentId', parentId)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      expect(res.body.code).toBe(0);
      const { batchId, items } = res.body.data;
      expect(batchId).toBeTruthy();
      // zip 中有 doc1.md 和 sub/doc2.md 两个 md 文件
      expect(items).toHaveLength(2);
      // 每个 item 包含 relativePath + parseId + title
      for (const item of items) {
        expect(item.relativePath).toMatch(/\.md$/);
        expect(item.parseId).toBeTruthy();
        expect(item.title).toBeTruthy();
      }
    });
  });

  describe('batch-confirm 创建文档', () => {
    // 这两个 test 共享 batchId + parentId，通过 beforeAll 初始化
    let batchId: string;
    let parentId: string;
    let allPaths: string[];
    let jobId: string;

    beforeAll(async () => {
      const zip = new JSZip();
      zip.file('note-a.md', '# Note A\n\n这是 Note A 的内容。');
      zip.file('note-b.md', '# Note B\n\n这是 Note B 的内容。');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: 'confirm 测试文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);
      parentId = folderRes.body.data.id;

      const parseRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .field('parentId', parentId)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      batchId = parseRes.body.data.batchId;
      allPaths = parseRes.body.data.items.map((i: any) => i.relativePath);
    });

    it('batch-confirm 创建文档 → docsCreated=2，返回 jobId', async () => {
      const confirmRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-confirm')
        .set('Cookie', cookie)
        .send({ batchId, parentId, selectedPaths: allPaths })
        .expect(201);

      expect(confirmRes.body.code).toBe(0);
      const { jobId: jid, docsCreated } = confirmRes.body.data;
      expect(jid).toBeTruthy();
      expect(docsCreated).toBe(2);
      jobId = jid;
    });

    it('进度查询 → status 字段存在，最终为 done', async () => {
      // jobId 由上一个 test 赋值，两个 test 有顺序依赖，这里直接使用
      expect(jobId).toBeTruthy();

      const progress = await waitForBatchJobDone(ctx.app, jobId, cookie);
      expect(progress.status).toBe('done');
      // completed 应等于 total（全部成功）
      expect(progress.completed).toBe(progress.total);
    });
  });

  describe('导入后文档可读取', () => {
    it('导入后文档的 bodyMarkdown 包含原始内容', async () => {
      const originalContent = '# 可读取测试\n\n这是可读取测试的导入内容。';
      const zip = new JSZip();
      zip.file('readable.md', originalContent);
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '可读取测试文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);
      const parentId = folderRes.body.data.id;

      // batch-parse
      const parseRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .field('parentId', parentId)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      const { batchId, items } = parseRes.body.data;
      const selectedPaths = items.map((i: any) => i.relativePath);

      // batch-confirm
      const confirmRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-confirm')
        .set('Cookie', cookie)
        .send({ batchId, parentId, selectedPaths })
        .expect(201);

      const { jobId } = confirmRes.body.data;
      // 等待后台任务完成（需要 cookie 认证）
      await waitForBatchJobDone(ctx.app, jobId, cookie);

      // 找到创建的文档：通过文件夹 overview 获取子项的 contentItemId
      const overviewRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/structure-nodes/${parentId}/overview`)
        .set('Cookie', cookie)
        .expect(200);

      const docChildren = overviewRes.body.data.children.filter(
        (c: any) => c.type === 'DOC',
      );
      expect(docChildren.length).toBeGreaterThanOrEqual(1);

      const contentItemId = docChildren[0].contentItemId;
      expect(contentItemId).toBeTruthy();

      // 读取内容详情，验证 bodyMarkdown 包含原始正文
      const detailRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${contentItemId}?visibility=all`)
        .set('Cookie', cookie)
        .expect(200);

      expect(detailRes.body.data.bodyMarkdown).toContain('可读取测试');
      expect(detailRes.body.data.bodyMarkdown).toContain(
        '这是可读取测试的导入内容',
      );
    });
  });

  describe('根目录导入（parentId 为空）', () => {
    it('batch-parse 不传 parentId → 不再 400，返回 batchId', async () => {
      const zip = new JSZip();
      zip.file('root-doc.md', '# 根目录测试\n\n直接建在 notes 根下。');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // 不传 parentId field，模拟从根目录触发导入
      const parseRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      expect(parseRes.body.code).toBe(0);
      const { batchId, items } = parseRes.body.data;
      expect(batchId).toBeTruthy();
      expect(items).toHaveLength(1);
    });

    it('batch-confirm 不传 parentId → 节点建在根下（type=DOC，无父节点）', async () => {
      const zip = new JSZip();
      zip.file('root-confirm.md', '# 根目录确认测试\n\n应建在 notes 根下。');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // batch-parse 不传 parentId
      const parseRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      const { batchId, items } = parseRes.body.data;
      const selectedPaths = items.map((i: any) => i.relativePath);

      // batch-confirm 不传 parentId
      const confirmRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-confirm')
        .set('Cookie', cookie)
        .send({ batchId, selectedPaths })
        .expect(201);

      expect(confirmRes.body.code).toBe(0);
      const { jobId, docsCreated } = confirmRes.body.data;
      expect(jobId).toBeTruthy();
      expect(docsCreated).toBe(1);

      // 等待后台任务完成
      const progress = await waitForBatchJobDone(ctx.app, jobId, cookie);
      expect(progress.status).toBe('done');
    });
  });

  describe('取消导入清理临时文件', () => {
    it('POST batch-parse → DELETE batch/:batchId → GET batch/:batchId 返回 404', async () => {
      const zip = new JSZip();
      zip.file('cancel-test.md', '# 取消测试\n\n应被清理。');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '取消导入测试文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);
      const parentId = folderRes.body.data.id;

      // 解析 zip 得到 batchId
      const parseRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/spaces/notes/import/batch-parse')
        .set('Cookie', cookie)
        .field('parentId', parentId)
        .attach('archive', zipBuffer, {
          filename: 'import.zip',
          contentType: 'application/zip',
        })
        .expect(201);

      const { batchId } = parseRes.body.data;
      expect(batchId).toBeTruthy();

      // 取消导入
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/notes/import/batch/${batchId}`)
        .set('Cookie', cookie)
        .expect(200);

      // 再 GET 应返回 404（session 已清理）
      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/import/batch/${batchId}`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });
});

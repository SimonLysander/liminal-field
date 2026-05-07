/**
 * import-confirm.e2e-spec.ts — 文件导入完整链路 E2E 测试
 *
 * 覆盖关键路径：parse（上传 .md 文件）→ confirm（确认导入）→ 读取详情验证内容。
 * OssService mock 已升级为 Map-based，parse 阶段写入的内容可在 confirm 阶段正确读取。
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';

describe('Import Confirm (e2e)', () => {
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

  it('导入 markdown → 确认 → 读取详情有 bodyMarkdown', async () => {
    const mdContent = '# 测试导入\n\n这是导入的正文内容。';

    // ─── 1. 上传 .md 文件，获取 parseId ───
    const parseRes = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/import/parse')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(mdContent, 'utf-8'), {
        filename: 'test.md',
        contentType: 'text/markdown',
      })
      .expect(201);

    expect(parseRes.body.code).toBe(0);
    const parseId: string = parseRes.body.data.parseId;
    expect(parseId).toMatch(/^[a-f0-9]{16}$/);

    // ─── 2. 确认导入，正式创建 content item ───
    const confirmRes = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/import/confirm')
      .set('Cookie', cookie)
      .send({ parseId, title: '测试导入文档' })
      .expect(201);

    expect(confirmRes.body.code).toBe(0);
    const { contentItemId } = confirmRes.body.data;
    expect(contentItemId).toMatch(/^ci_/);

    // ─── 3. 读取导入后的内容详情，验证 bodyMarkdown 已正确写入 ───
    const detailRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/notes/items/${contentItemId}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);

    expect(detailRes.body.code).toBe(0);
    const detail = detailRes.body.data;

    // bodyMarkdown 应包含原始 markdown 中的正文（标题由 processMarkdown 归一化为 h1）
    expect(detail.bodyMarkdown).toContain('测试导入');
    expect(detail.bodyMarkdown).toContain('这是导入的正文内容');

    // latestVersion 应存在，versionId 由 confirm 时生成
    expect(detail.latestVersion).toBeDefined();
    expect(detail.latestVersion.versionId).toBeTruthy();
  });

  it('上传非支持格式文件 → 400', async () => {
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/import/parse')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('hello'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('confirm 使用不存在的 parseId → 404', async () => {
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/import/confirm')
      .set('Cookie', cookie)
      .send({ parseId: 'aabbccddeeff0011', title: '不存在' })
      .expect(404);
  });

  it('未登录调用 parse → 401', async () => {
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/import/parse')
      .attach('file', Buffer.from('# test'), {
        filename: 'test.md',
        contentType: 'text/markdown',
      })
      .expect(401);
  });
});

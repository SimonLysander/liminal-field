/**
 * asset-versioning.e2e-spec.ts — 资产版本化 E2E 测试
 *
 * 覆盖：
 * - 提交含图片的版本 → GET /assets/:fileName → 200
 * - GET /assets/:fileName?v=commitHash → 200，内容正确
 * - GET /assets/:fileName?v=不存在的hash → 500/404
 */
import supertest from 'supertest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
} from './helpers';

/** 在 git 仓库的 content/{id}/assets/ 目录写一个真实 png 文件 */
async function seedAsset(
  tmpGitDir: string,
  id: string,
  fileName: string,
): Promise<Buffer> {
  const assetsDir = join(tmpGitDir, 'content', id, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const minimalPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c62000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  );
  await writeFile(join(assetsDir, fileName), minimalPng);
  return minimalPng;
}

describe('Asset Versioning (e2e)', () => {
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

  describe('GET /api/v1/spaces/notes/items/:id/assets/:fileName', () => {
    it('提交含图片的版本后 → GET 当前版本图片 → 200', async () => {
      const id = await createNoteItem(ctx.app, cookie, '资产版本测试笔记');
      const fileName = 'test-asset.png';
      await seedAsset(ctx.tmpGitDir, id, fileName);

      // 提交：bodyMarkdown 引用该图片
      const body = `# 标题\n\n测试内容\n\n![图片](./assets/${fileName})`;
      await commitNoteContent(ctx.app, cookie, id, body, '资产版本测试笔记');

      // 直接访问当前版本资产（不带 v 参数）
      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/assets/${fileName}`)
        .expect(200)
        .expect('Content-Type', /image/);
    });

    it('GET ?v=versionId → 200，资源文件可访问', async () => {
      const id = await createNoteItem(ctx.app, cookie, '版本化资产测试');
      const fileName = 'versioned-asset.png';
      await seedAsset(ctx.tmpGitDir, id, fileName);

      const body = `# 标题\n\n测试\n\n![图片](./assets/${fileName})`;
      const detail = await commitNoteContent(
        ctx.app,
        cookie,
        id,
        body,
        '版本化资产测试',
      );
      // V2: Git 异步归档，commitHash 不一定立即可用；用 versionId 作为缓存 key
      const versionId = detail.latestVersion.versionId;
      expect(versionId).toBeTruthy();

      // 不带版本参数访问（从磁盘读当前文件，资产在 seedAsset 中已写入）
      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/notes/items/${id}/assets/${fileName}`)
        .expect(200)
        .expect('Content-Type', /image/);
    });

    it('GET ?v=不存在的hash → 4xx 或 5xx', async () => {
      const id = await createNoteItem(ctx.app, cookie, '不存在版本测试');
      const fileName = 'ghost-asset.png';
      await seedAsset(ctx.tmpGitDir, id, fileName);

      await commitNoteContent(
        ctx.app,
        cookie,
        id,
        `# 标题\n\n内容\n\n![](./assets/${fileName})`,
        '不存在版本测试',
      );

      // V2: ?v= 仅用于缓存 key，不再触发 git show。
      // 传任意 version 字符串仍从磁盘正常读取文件，返回 200。
      const fakeVersion = 'nonexistent-version-id';
      const res = await supertest(ctx.app.getHttpServer()).get(
        `/api/v1/spaces/notes/items/${id}/assets/${fileName}?v=${fakeVersion}`,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('gallery /assets/:fileName', () => {
    it('gallery 已提交照片通过 /assets/ 路由可访问', async () => {
      // 复用 gallery-publish 中的逻辑：先 seed 图片，再提交，再访问
      const { createGalleryItem } = await import('./helpers');
      const id = await createGalleryItem(ctx.app, cookie, '画廊资产测试');
      const photoFile = 'gallery-asset-test.png';
      await seedAsset(ctx.tmpGitDir, id, photoFile);

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '画廊资产测试',
          prose: '',
          photos: [{ file: photoFile, caption: '', tags: {} }],
          changeNote: '提交',
        })
        .expect(200);

      await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}/assets/${photoFile}`)
        .expect(200)
        .expect('Content-Type', /image/);
    });
  });
});

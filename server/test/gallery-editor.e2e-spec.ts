/**
 * gallery-editor.e2e-spec.ts — 画廊编辑器状态 E2E 测试
 *
 * 覆盖：
 * - 无草稿时 GET /editor 返回正式版数据
 * - 保存草稿后 GET /editor 返回草稿数据 + hasDraft=true
 * - 验证照片 URL 路径正确（Git assets vs draft-assets）
 */
import supertest from 'supertest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { TestContext, login, createGalleryItem } from './helpers';

async function seedPhotoAsset(
  tmpGitDir: string,
  id: string,
  fileName: string,
): Promise<void> {
  const assetsDir = join(tmpGitDir, 'content', id, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const minimalPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c62000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  );
  await writeFile(join(assetsDir, fileName), minimalPng);
}

describe('Gallery Editor (e2e)', () => {
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

  describe('GET /api/v1/spaces/gallery/items/:id/editor', () => {
    it('无草稿时返回正式版数据，hasDraft=false', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '编辑器无草稿测试');

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}/editor`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.id).toBe(id);
      expect(res.body.data.hasDraft).toBe(false);
      expect(res.body.data.draftSavedAt).toBeNull();
    });

    it('保存草稿后 GET /editor → 返回草稿数据，hasDraft=true', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '编辑器草稿测试');

      // 保存草稿
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '草稿相册标题',
          prose: '草稿随笔',
          photos: [],
          changeNote: '草稿保存',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}/editor`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.hasDraft).toBe(true);
      expect(res.body.data.title).toBe('草稿相册标题');
      expect(res.body.data.prose).toBe('草稿随笔');
      expect(res.body.data.draftSavedAt).toBeDefined();
    });

    it('已提交照片 → editor 中照片 URL 用 Git assets 路径', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '编辑器URL测试');
      const photoFile = 'editor-photo.png';
      await seedPhotoAsset(ctx.tmpGitDir, id, photoFile);

      // 提交含照片的内容
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${id}`)
        .set('Cookie', cookie)
        .send({
          title: '编辑器URL测试',
          prose: '',
          photos: [{ file: photoFile, caption: '', tags: {} }],
          changeNote: '提交',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}/editor`)
        .set('Cookie', cookie)
        .expect(200);

      const photos: any[] = res.body.data.photos;
      expect(photos.length).toBeGreaterThan(0);
      // 已提交的照片 URL 应走 /assets/ 路径（Git 存储），不含 draft-assets
      expect(photos[0].url).toContain('/assets/');
      expect(photos[0].url).not.toContain('/draft-assets/');
    });

    it('有草稿且含未提交照片 → draft-assets URL', async () => {
      const id = await createGalleryItem(ctx.app, cookie, '编辑器草稿URL测试');
      const draftPhotoFile = 'draft-only-photo.png';

      // 保存含"草稿照片"（不存在于 git assets）的草稿
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${id}/draft`)
        .set('Cookie', cookie)
        .send({
          title: '草稿URL测试',
          prose: '',
          photos: [{ file: draftPhotoFile, caption: '', tags: {} }],
          changeNote: '草稿保存',
        })
        .expect(200);

      const res = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/spaces/gallery/items/${id}/editor`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.hasDraft).toBe(true);
      const photos: any[] = res.body.data.photos;
      expect(photos.length).toBeGreaterThan(0);
      // 未提交到 Git 的照片应走 draft-assets 路径（MinIO 代理）
      expect(photos[0].url).toContain('/draft-assets/');
    });
  });
});

/**
 * delete-published-guard.e2e-spec.ts — 已发布内容删除保护 E2E 测试
 *
 * 覆盖：
 * - 已发布笔记不能直接删除（structure node）→ 400，错误信息含「已发布」
 * - 取消发布后可以删除 → 200
 * - 未发布笔记可直接删除 → 200
 * - 已发布文件夹（含已发布子文档）不能删除 → 400
 * - 已发布画廊不能直接删除 → 400
 * - 取消发布后画廊可以删除 → 200
 *
 * 架构说明：
 * - 笔记/文件夹的删除走 DELETE /api/v1/structure-nodes/:id（NavigationNodeController），
 *   该层在删除前递归检查所有后代节点是否有已发布内容，有则拒绝。
 * - 画廊的删除走 DELETE /api/v1/spaces/gallery/items/:id（WorkspaceController），
 *   WorkspaceService.remove 检查 publishedVersion 不为空时抛 400。
 */
import supertest from 'supertest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
  createGalleryItem,
} from './helpers';

/** 在 git 仓库的 content/{id}/assets/ 写一个 1x1 PNG 占位文件（用于绕过画廊发布的 assertPublishable 校验） */
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

describe('Delete Published Guard (e2e)', () => {
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

  // ─── Notes ───

  describe('已发布笔记的删除保护（structure-node 层）', () => {
    it('已发布笔记不能直接删除 → 400，错误含「已发布」', async () => {
      // createNoteItem 同时创建 ContentItem + NavigationNode
      const id = await createNoteItem(ctx.app, cookie, '删除保护测试-已发布');
      await commitNoteContent(ctx.app, cookie, id);

      // 发布
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 查找该 content item 对应的 structure node id
      const pathRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/contents/${id}/structure-path`)
        .set('Cookie', cookie)
        .expect(200);
      const nodeId = pathRes.body.data[pathRes.body.data.length - 1].id;

      // 尝试删除 structure node → 应被拒绝
      const delRes = await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${nodeId}`)
        .set('Cookie', cookie);

      expect(delRes.status).toBe(400);
      expect(delRes.body.msg ?? delRes.body.message).toMatch(/已发布/);
    });

    it('取消发布后可以删除 → 200', async () => {
      const id = await createNoteItem(
        ctx.app,
        cookie,
        '删除保护测试-取消发布后删',
      );
      await commitNoteContent(ctx.app, cookie, id);

      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 取消发布
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${id}/unpublish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 获取 structure node id
      const pathRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/contents/${id}/structure-path`)
        .set('Cookie', cookie)
        .expect(200);
      const nodeId = pathRes.body.data[pathRes.body.data.length - 1].id;

      // 删除应成功
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${nodeId}`)
        .set('Cookie', cookie)
        .expect(200);
    });

    it('未发布笔记可以直接删除 → 200', async () => {
      const id = await createNoteItem(
        ctx.app,
        cookie,
        '删除保护测试-未发布直接删',
      );
      await commitNoteContent(ctx.app, cookie, id);
      // 不发布，直接删

      const pathRes = await supertest(ctx.app.getHttpServer())
        .get(`/api/v1/contents/${id}/structure-path`)
        .set('Cookie', cookie)
        .expect(200);
      const nodeId = pathRes.body.data[pathRes.body.data.length - 1].id;

      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${nodeId}`)
        .set('Cookie', cookie)
        .expect(200);
    });
  });

  describe('已发布文件夹的删除保护（级联检查）', () => {
    it('已发布文件夹（含已发布子文档）不能删除 → 400', async () => {
      // 创建文件夹
      const folderRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ name: '删除保护文件夹', type: 'FOLDER', scope: 'notes' })
        .expect(201);
      const folderId = folderRes.body.data.id;

      // 在文件夹下创建 DOC 节点（后端自动创建 ContentItem）
      const docRes = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({
          name: '文件夹内子文档',
          type: 'DOC',
          scope: 'notes',
          parentId: folderId,
        })
        .expect(201);
      const contentItemId = docRes.body.data.contentItemId;
      expect(contentItemId).toBeTruthy();

      // 提交并发布子文档
      await commitNoteContent(ctx.app, cookie, contentItemId);
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/notes/items/${contentItemId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 尝试删除文件夹 → 应因子文档已发布而被拒绝
      const delRes = await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${folderId}`)
        .set('Cookie', cookie);

      expect(delRes.status).toBe(400);
      expect(delRes.body.msg ?? delRes.body.message).toMatch(/已发布/);
    });
  });

  // ─── Gallery ───

  describe('已发布画廊的删除保护（workspace 层）', () => {
    // 在 describe 内共享 gallery id，方便 test 2 继续复用
    let galleryId: string;

    it('已发布画廊不能直接删除 → 400', async () => {
      galleryId = await createGalleryItem(ctx.app, cookie, '删除保护相册');
      const photoFile = 'guard-photo.png';
      await seedPhotoAsset(ctx.tmpGitDir, galleryId, photoFile);

      // 提交含照片的内容
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${galleryId}`)
        .set('Cookie', cookie)
        .send({
          title: '删除保护相册',
          prose: '测试正文',
          photos: [{ file: photoFile, caption: '测试照片', tags: {} }],
          changeNote: '初始提交',
        })
        .expect(200);

      // 发布
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${galleryId}/publish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 尝试删除已发布画廊 → 应被拒绝
      const delRes = await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/gallery/items/${galleryId}`)
        .set('Cookie', cookie);

      expect(delRes.status).toBe(400);
      // WorkspaceService.remove 抛 '已发布内容请先取消发布再删除'
      expect(delRes.body.code).not.toBe(0);
    });

    it('取消发布后画廊可以删除 → 200', async () => {
      // 取消发布
      await supertest(ctx.app.getHttpServer())
        .put(`/api/v1/spaces/gallery/items/${galleryId}/unpublish`)
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // 删除应成功
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/spaces/gallery/items/${galleryId}`)
        .set('Cookie', cookie)
        .expect(200);
    });
  });
});

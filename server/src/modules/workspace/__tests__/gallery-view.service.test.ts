/**
 * GalleryViewService 单元测试。
 *
 * 测试重点：
 * - frontmatter 解析：cover、tags、photos（含 photo 级 tags）从 main.md 正确读取
 * - 旧数据兼容：无 frontmatter 时正常降级
 * - 封面图优先级：frontmatter.cover > assets 首图 > null
 * - toPostDetailDto：frontmatter 顺序 + assets 追加逻辑
 * - readPhotoBuffer：委托 contentRepoService
 */
import { NotFoundException } from '@nestjs/common';
import { GalleryViewService } from '../gallery-view.service';
import { ContentRepository } from '../../content/content.repository';
import { ContentRepoService } from '../../content/content-repo.service';

describe('GalleryViewService', () => {
  let service: GalleryViewService;
  let contentRepository: jest.Mocked<ContentRepository>;
  let contentRepoService: jest.Mocked<ContentRepoService>;

  // 可复用的 mock 数据
  const contentItem = {
    _id: 'ci_gal1',
    id: 'ci_gal1',
    latestVersion: { commitHash: 'aaa', title: 'Sunset', summary: 'A sunset' },
    publishedVersion: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  const imageAssets = [
    { path: 'content/ci_gal1/assets/a.jpg', fileName: 'a.jpg', type: 'image', size: 1000 },
    { path: 'content/ci_gal1/assets/b.png', fileName: 'b.png', type: 'image', size: 2000 },
  ];

  const mixedAssets = [
    ...imageAssets,
    { path: 'content/ci_gal1/assets/note.txt', fileName: 'note.txt', type: 'file', size: 50 },
  ];

  beforeEach(() => {
    contentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ContentRepository>;

    contentRepoService = {
      listAssets: jest.fn(),
      readContentSource: jest.fn(),
      readAssetBuffer: jest.fn(),
    } as unknown as jest.Mocked<ContentRepoService>;

    // 新版 GalleryViewService 不再注入 GalleryPostMetaRepository
    service = new GalleryViewService(contentRepository, contentRepoService);
  });

  // ─── toPostDto ───

  describe('toPostDto()', () => {
    it('无 frontmatter 时，封面取第一张 image asset，tags={}，cover=null', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'Beautiful sunset',
        plainText: 'Beautiful sunset',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.coverUrl).toBe('/api/v1/spaces/gallery/items/ci_gal1/assets/a.jpg');
      expect(result.photoCount).toBe(2);
      expect(result.title).toBe('Sunset');
      expect(result.description).toBe('Beautiful sunset');
      expect(result.tags).toEqual({});
      expect(result.coverPhotoFileName).toBeNull();
    });

    it('frontmatter 中指定 cover 时，优先用 cover 文件作封面', async () => {
      const mainMd = `---
cover: b.png
tags:
  location: Paris
photos: []
---

随笔正文`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: '随笔正文',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.coverUrl).toBe('/api/v1/spaces/gallery/items/ci_gal1/assets/b.png');
      expect(result.coverPhotoFileName).toBe('b.png');
      expect(result.tags).toEqual({ location: 'Paris' });
    });

    it('frontmatter cover 指定的文件不在 assets 中时，退化为首图', async () => {
      const mainMd = `---
cover: missing.jpg
---

prose`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: 'prose',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      // missing.jpg 不在 assets 中，退化为首图 a.jpg
      expect(result.coverUrl).toBe('/api/v1/spaces/gallery/items/ci_gal1/assets/a.jpg');
    });

    it('无 image asset 时 coverUrl 为 null', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue([
        { path: 'p', fileName: 'f.txt', type: 'file', size: 10 },
      ] as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'text',
        plainText: 'text',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.coverUrl).toBeNull();
      expect(result.photoCount).toBe(0);
      expect(result.previewPhotoUrls).toEqual([]);
    });

    it('非 image asset 不计入照片数量', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(mixedAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      // 3 个 asset 但只有 2 个 image
      expect(result.photoCount).toBe(2);
    });

    it('previewPhotoUrls 最多返回前 9 张图片 URL', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      const manyAssets = Array.from({ length: 12 }, (_, i) => ({
        path: `content/ci_gal1/assets/${i}.jpg`,
        fileName: `${i}.jpg`,
        type: 'image',
        size: 100,
      }));
      contentRepoService.listAssets.mockResolvedValue(manyAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.previewPhotoUrls).toHaveLength(9);
    });

    it('prose 部分（frontmatter 之后的正文）作为 description', async () => {
      const mainMd = `---
cover: a.jpg
---

这是随笔正文内容`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue([] as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: '这是随笔正文内容',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.description).toBe('这是随笔正文内容');
    });

    it('已发布的 post status 为 published', async () => {
      const published = {
        ...contentItem,
        publishedVersion: { commitHash: 'bbb', title: 'Sunset', summary: 'A sunset' },
      };
      contentRepository.findById.mockResolvedValue(published as any);
      contentRepoService.listAssets.mockResolvedValue([] as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'x',
        plainText: 'x',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.status).toBe('published');
    });

    it('content item 不存在时抛 NotFoundException', async () => {
      contentRepository.findById.mockResolvedValue(null);

      await expect(service.toPostDto('ci_nope')).rejects.toThrow(NotFoundException);
    });

    it('readContentSource 失败时 description 降级为空串，其他字段正常', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockRejectedValue(new Error('no file'));

      const result = await service.toPostDto('ci_gal1');

      expect(result.description).toBe('');
      expect(result.tags).toEqual({});
      expect(result.coverPhotoFileName).toBeNull();
    });
  });

  // ─── toPostDetailDto ───

  describe('toPostDetailDto()', () => {
    it('无 frontmatter photos 时，按 assets 顺序排列，caption/tags 为空', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      // listAssets 被调用两次（toPostDto 内一次 + toPostDetailDto 内一次）
      contentRepoService.listAssets.mockResolvedValue(mixedAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);

      const result = await service.toPostDetailDto('ci_gal1');

      // 只包含 image 类型 asset
      expect(result.photos).toHaveLength(2);
      expect(result.photos[0]).toEqual({
        id: 'a.jpg',
        url: '/api/v1/spaces/gallery/items/ci_gal1/assets/a.jpg',
        fileName: 'a.jpg',
        size: 1000,
        order: 0,
        caption: '',
        tags: {},
      });
      expect(result.photos[1].order).toBe(1);
      expect(result.photos[1].caption).toBe('');
      expect(result.photos[1].tags).toEqual({});
      // 同时包含列表 DTO 的字段
      expect(result.title).toBe('Sunset');
      expect(result.photoCount).toBe(2);
    });

    it('frontmatter photos 的 caption、order（数组索引）和 photo 级 tags 正确合并', async () => {
      // b.png 在 frontmatter 排在第 0 位，a.jpg 排在第 1 位
      const mainMd = `---
photos:
  - file: b.png
    caption: Second photo
    tags:
      camera: GR III
  - file: a.jpg
    caption: First photo
    tags: {}
---

desc`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: 'desc',
        assetRefs: [],
      } as any);

      const result = await service.toPostDetailDto('ci_gal1');

      // 按 frontmatter 顺序：b.png(0) 在前，a.jpg(1) 在后
      expect(result.photos[0].fileName).toBe('b.png');
      expect(result.photos[0].caption).toBe('Second photo');
      expect(result.photos[0].order).toBe(0);
      expect(result.photos[0].tags).toEqual({ camera: 'GR III' });
      expect(result.photos[1].fileName).toBe('a.jpg');
      expect(result.photos[1].caption).toBe('First photo');
      expect(result.photos[1].order).toBe(1);
      expect(result.photos[1].tags).toEqual({});
    });

    it('frontmatter 未登记的 asset 追加到末尾', async () => {
      // frontmatter 只登记了 a.jpg，b.png 未登记
      const mainMd = `---
photos:
  - file: a.jpg
    caption: Only registered
    tags: {}
---

prose`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: 'prose',
        assetRefs: [],
      } as any);

      const result = await service.toPostDetailDto('ci_gal1');

      expect(result.photos).toHaveLength(2);
      // a.jpg 在前（frontmatter 登记，order=0）
      expect(result.photos[0].fileName).toBe('a.jpg');
      expect(result.photos[0].caption).toBe('Only registered');
      // b.png 追加到末尾（order=1，caption/tags 为空）
      expect(result.photos[1].fileName).toBe('b.png');
      expect(result.photos[1].caption).toBe('');
      expect(result.photos[1].tags).toEqual({});
    });

    it('frontmatter 中登记但 assets 不存在的文件跳过（已删除的照片）', async () => {
      // frontmatter 登记了 ghost.jpg，但 assets 中不存在
      const mainMd = `---
photos:
  - file: ghost.jpg
    caption: Deleted
    tags: {}
  - file: a.jpg
    caption: Existing
    tags: {}
---

prose`;
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: mainMd,
        plainText: 'prose',
        assetRefs: [],
      } as any);

      const result = await service.toPostDetailDto('ci_gal1');

      // ghost.jpg 不在 assets 中，跳过；a.jpg 正常，b.png 追加末尾
      const fileNames = result.photos.map((p) => p.fileName);
      expect(fileNames).not.toContain('ghost.jpg');
      expect(fileNames).toContain('a.jpg');
      expect(fileNames).toContain('b.png');
    });
  });

  // ─── readPhotoBuffer ───

  describe('readPhotoBuffer()', () => {
    it('委托 contentRepoService.readAssetBuffer', async () => {
      const expected = { buffer: Buffer.from('img'), contentType: 'image/jpeg' };
      contentRepoService.readAssetBuffer.mockResolvedValue(expected as any);

      const result = await service.readPhotoBuffer('ci_gal1', 'a.jpg');

      expect(result).toBe(expected);
      expect(contentRepoService.readAssetBuffer).toHaveBeenCalledWith('ci_gal1', 'a.jpg');
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { GalleryViewService } from '../gallery-view.service';
import { ContentRepository } from '../../content/content.repository';
import { ContentRepoService } from '../../content/content-repo.service';
import { GalleryPostMetaRepository } from '../gallery-post-meta.repository';

describe('GalleryViewService', () => {
  let service: GalleryViewService;
  let contentRepository: jest.Mocked<ContentRepository>;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let galleryPostMetaRepository: jest.Mocked<GalleryPostMetaRepository>;

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

    galleryPostMetaRepository = {
      findByContentItemId: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      deleteByContentItemId: jest.fn(),
    } as unknown as jest.Mocked<GalleryPostMetaRepository>;

    service = new GalleryViewService(
      contentRepository,
      contentRepoService,
      galleryPostMetaRepository,
    );
  });

  // ─── toPostDto ───

  describe('toPostDto()', () => {
    it('封面图取第一张 image asset 的 URL（无 MongoDB 元数据时）', async () => {
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

    it('MongoDB 元数据中指定了 coverPhotoFileName 时优先使用', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);
      galleryPostMetaRepository.findByContentItemId.mockResolvedValue({
        contentItemId: 'ci_gal1',
        photos: [],
        coverPhotoFileName: 'b.png',
        tags: { location: 'Paris' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.coverUrl).toBe('/api/v1/spaces/gallery/items/ci_gal1/assets/b.png');
      expect(result.coverPhotoFileName).toBe('b.png');
      expect(result.tags).toEqual({ location: 'Paris' });
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

    it('零宽占位符还原为空描述', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue([] as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: '\u200B',
        plainText: '',
        assetRefs: [],
      } as any);

      const result = await service.toPostDto('ci_gal1');

      expect(result.description).toBe('');
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

    it('readContentSource 失败时 description 降级为空串', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue([] as any);
      contentRepoService.readContentSource.mockRejectedValue(new Error('no file'));

      const result = await service.toPostDto('ci_gal1');

      expect(result.description).toBe('');
    });
  });

  // ─── toPostDetailDto ───

  describe('toPostDetailDto()', () => {
    it('在列表 DTO 基础上追加完整照片列表，无元数据时 caption 为空串', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
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
      });
      expect(result.photos[1].order).toBe(1);
      expect(result.photos[1].caption).toBe('');
      // 同时包含列表 DTO 的字段
      expect(result.title).toBe('Sunset');
      expect(result.photoCount).toBe(2);
    });

    it('MongoDB 元数据中的 caption 和 order 正确合并', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);
      galleryPostMetaRepository.findByContentItemId.mockResolvedValue({
        contentItemId: 'ci_gal1',
        photos: [
          { fileName: 'b.png', caption: 'Second photo', order: 0 },
          { fileName: 'a.jpg', caption: 'First photo', order: 1 },
        ],
        coverPhotoFileName: null,
        tags: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.toPostDetailDto('ci_gal1');

      // 按 order 升序排列：b.png(0) 在前，a.jpg(1) 在后
      expect(result.photos[0].fileName).toBe('b.png');
      expect(result.photos[0].caption).toBe('Second photo');
      expect(result.photos[0].order).toBe(0);
      expect(result.photos[1].fileName).toBe('a.jpg');
      expect(result.photos[1].caption).toBe('First photo');
    });
  });

  // ─── updateMeta ───

  describe('updateMeta()', () => {
    it('调用 upsert 并返回 toPostDetailDto 结果', async () => {
      contentRepository.findById.mockResolvedValue(contentItem as any);
      contentRepoService.listAssets.mockResolvedValue(imageAssets as any);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'desc',
        plainText: 'desc',
        assetRefs: [],
      } as any);
      galleryPostMetaRepository.upsert.mockResolvedValue({
        contentItemId: 'ci_gal1',
        photos: [],
        coverPhotoFileName: 'a.jpg',
        tags: { season: 'summer' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const dto = { coverPhotoFileName: 'a.jpg', tags: { season: 'summer' } };
      const result = await service.updateMeta('ci_gal1', dto);

      expect(galleryPostMetaRepository.upsert).toHaveBeenCalledWith('ci_gal1', dto);
      expect(result.photos).toBeDefined();
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

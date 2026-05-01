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

    service = new GalleryViewService(contentRepository, contentRepoService);
  });

  // ─── toPostDto ───

  describe('toPostDto()', () => {
    it('封面图取第一张 image asset 的 URL', async () => {
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
    it('在列表 DTO 基础上追加完整照片列表', async () => {
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
      });
      expect(result.photos[1].order).toBe(1);
      // 同时包含列表 DTO 的字段
      expect(result.title).toBe('Sunset');
      expect(result.photoCount).toBe(2);
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

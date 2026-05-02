/**
 * GalleryViewService — 画廊 scope 的特有逻辑。
 *
 * 处理画廊模块独有的视图转换：
 * - 从 Content 存储层的 asset 列表推导封面图（优先取 MongoDB 侧手动指定的封面，否则用首图）
 * - 将 MongoDB 侧的照片元数据（caption、order）与 Git 侧 asset 列表合并
 * - 照片计数、照片 URL 构建、previewPhotoUrls（前 9 张）
 * - 照片文件直出（readPhotoBuffer）
 * - updateMeta：写入 MongoDB 侧元数据并返回最新 detail
 *
 * 不包含 CRUD 逻辑 — 那由 WorkspaceService 统一处理。
 * 从原 GalleryModule（gallery.service.ts）的视图部分迁移而来。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { GalleryPostMetaRepository } from './gallery-post-meta.repository';
import {
  GalleryPhotoDto,
  GalleryPostDto,
  GalleryPostDetailDto,
} from './dto/gallery-view.dto';
import { UpdateGalleryMetaDto } from './dto/update-gallery-meta.dto';

// 画廊描述的零宽占位符，toPostDto 时需要还原为空串。
const EMPTY_DESCRIPTION_PLACEHOLDER = '\u200B';

// 列表页最多显示的预览图数量。
const PREVIEW_PHOTO_LIMIT = 9;

@Injectable()
export class GalleryViewService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly galleryPostMetaRepository: GalleryPostMetaRepository,
  ) {}

  /** 构建照片的统一访问 URL（走 /spaces/gallery/items/:id/assets/:fileName）。 */
  private buildPhotoUrl(contentItemId: string, fileName: string): string {
    return `/api/v1/spaces/gallery/items/${contentItemId}/assets/${fileName}`;
  }

  /**
   * 将 Content 存储层数据转换为画廊列表 DTO。
   * - 封面图：优先取 MongoDB 侧 coverPhotoFileName，未指定时退化为首图
   * - tags / coverPhotoFileName / previewPhotoUrls：从 MongoDB 元数据合并
   */
  async toPostDto(contentItemId: string): Promise<GalleryPostDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const [assets, meta] = await Promise.all([
      this.contentRepoService.listAssets(contentItemId),
      this.galleryPostMetaRepository.findByContentItemId(contentItemId),
    ]);
    const imageAssets = assets.filter((a) => a.type === 'image');

    // 封面图优先级：MongoDB 手动指定 > 首图
    const coverFileName = meta?.coverPhotoFileName ?? null;
    const coverAsset = coverFileName
      ? imageAssets.find((a) => a.fileName === coverFileName) ?? imageAssets[0]
      : imageAssets[0];

    const version = content.latestVersion!;

    let description = '';
    try {
      const source =
        await this.contentRepoService.readContentSource(contentItemId);
      description =
        source.bodyMarkdown === EMPTY_DESCRIPTION_PLACEHOLDER
          ? ''
          : source.bodyMarkdown;
    } catch {
      // 内容文件还不存在
    }

    // 前 N 张图片 URL，用于列表页缩略图预览
    const previewPhotoUrls = imageAssets
      .slice(0, PREVIEW_PHOTO_LIMIT)
      .map((a) => this.buildPhotoUrl(contentItemId, a.fileName));

    return {
      id: contentItemId,
      title: version.title,
      description,
      status: content.publishedVersion ? 'published' : 'draft',
      coverUrl: coverAsset
        ? this.buildPhotoUrl(contentItemId, coverAsset.fileName)
        : null,
      photoCount: imageAssets.length,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
      tags: meta?.tags ?? {},
      coverPhotoFileName: meta?.coverPhotoFileName ?? null,
      previewPhotoUrls,
      publishedCommitHash: content.publishedVersion?.commitHash ?? null,
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.commitHash !== content.publishedVersion?.commitHash
        : false,
    };
  }

  /**
   * 画廊详情 DTO：在列表 DTO 基础上追加完整照片列表。
   * 照片排序规则：以 MongoDB 侧 order 为准；未在元数据中登记的照片
   * 追加到末尾（按 Git asset 列表原始顺序）。
   * caption 从 MongoDB 元数据合并，未登记时默认空串。
   */
  async toPostDetailDto(
    contentItemId: string,
  ): Promise<GalleryPostDetailDto> {
    const [postDto, assets, meta] = await Promise.all([
      this.toPostDto(contentItemId),
      this.contentRepoService.listAssets(contentItemId),
      this.galleryPostMetaRepository.findByContentItemId(contentItemId),
    ]);

    const imageAssets = assets.filter((a) => a.type === 'image');

    // 构建 fileName -> PhotoMeta 查找表
    const metaByFileName = new Map(
      (meta?.photos ?? []).map((p) => [p.fileName, p]),
    );

    // 合并 Git 资产与 MongoDB 元数据
    const photos: GalleryPhotoDto[] = imageAssets.map((asset, fallbackIndex) => {
      const photoMeta = metaByFileName.get(asset.fileName);
      return {
        id: asset.fileName,
        url: this.buildPhotoUrl(contentItemId, asset.fileName),
        fileName: asset.fileName,
        size: asset.size,
        // 有元数据时用其 order，否则用 Git 列表原始索引作为兜底
        order: photoMeta?.order ?? fallbackIndex,
        caption: photoMeta?.caption ?? '',
      };
    });

    // 按 order 升序排列
    photos.sort((a, b) => a.order - b.order);

    return { ...postDto, photos };
  }

  /**
   * 写入 MongoDB 侧元数据并返回更新后的详情。
   * 调用方（Controller）负责身份验证，本方法只做业务更新。
   */
  async updateMeta(
    contentItemId: string,
    dto: UpdateGalleryMetaDto,
  ): Promise<GalleryPostDetailDto> {
    await this.galleryPostMetaRepository.upsert(contentItemId, {
      ...(dto.photos !== undefined && { photos: dto.photos }),
      ...(dto.coverPhotoFileName !== undefined && {
        coverPhotoFileName: dto.coverPhotoFileName,
      }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
    });
    return this.toPostDetailDto(contentItemId);
  }

  /** 直接读取照片文件 buffer，用于文件直出端点。 */
  async readPhotoBuffer(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.contentRepoService.readAssetBuffer(contentItemId, fileName);
  }
}

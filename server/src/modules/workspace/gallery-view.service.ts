/**
 * GalleryViewService — 画廊 scope 的特有逻辑。
 *
 * 处理画廊模块独有的视图转换：
 * - 从 Content 存储层的 asset 列表推导封面图（第一张 image asset）
 * - 照片计数、照片 URL 构建
 * - 照片文件直出（readPhotoBuffer）
 *
 * 不包含 CRUD 逻辑 — 那由 WorkspaceService 统一处理。
 * 从原 GalleryModule（gallery.service.ts）的视图部分迁移而来。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import {
  GalleryPhotoDto,
  GalleryPostDto,
  GalleryPostDetailDto,
} from './dto/gallery-view.dto';

// 画廊描述的零宽占位符，toPostDto 时需要还原为空串。
const EMPTY_DESCRIPTION_PLACEHOLDER = '\u200B';

@Injectable()
export class GalleryViewService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
  ) {}

  /** 构建照片的统一访问 URL（走 /spaces/gallery/items/:id/assets/:fileName）。 */
  private buildPhotoUrl(contentItemId: string, fileName: string): string {
    return `/api/v1/spaces/gallery/items/${contentItemId}/assets/${fileName}`;
  }

  /** 将 Content 存储层数据转换为画廊列表 DTO（含封面图推导）。 */
  async toPostDto(contentItemId: string): Promise<GalleryPostDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const assets = await this.contentRepoService.listAssets(contentItemId);
    const imageAssets = assets.filter((a) => a.type === 'image');
    // 封面图约定：取第一张 image asset
    const coverAsset = imageAssets[0];
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
    };
  }

  /** 画廊详情 DTO：在列表 DTO 基础上追加完整照片列表。 */
  async toPostDetailDto(
    contentItemId: string,
  ): Promise<GalleryPostDetailDto> {
    const postDto = await this.toPostDto(contentItemId);
    const assets = await this.contentRepoService.listAssets(contentItemId);
    const imageAssets = assets.filter((a) => a.type === 'image');

    const photos: GalleryPhotoDto[] = imageAssets.map((asset, index) => ({
      id: asset.fileName,
      url: this.buildPhotoUrl(contentItemId, asset.fileName),
      fileName: asset.fileName,
      size: asset.size,
      order: index,
    }));

    return { ...postDto, photos };
  }

  /** 直接读取照片文件 buffer，用于文件直出端点。 */
  async readPhotoBuffer(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.contentRepoService.readAssetBuffer(contentItemId, fileName);
  }
}
